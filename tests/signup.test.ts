import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { signupSchema, signupDestination, readPendingSignup, pendingSignupCookie } from "../lib/signup.ts";

const account = { firstName: " Alex ", lastName: " Rivera ", email: " ALEX@example.test ", password: "SafePassword123!", terms: "on" };

test("public signup validates identity, password and consent without requiring workspace membership", () => {
  const parsed = signupSchema.parse(account);
  assert.equal(parsed.firstName, "Alex");
  assert.equal(parsed.lastName, "Rivera");
  assert.equal(parsed.email, "alex@example.test");
  assert.equal(signupSchema.safeParse({ ...account, terms: undefined }).success, false);
  assert.equal(signupSchema.safeParse({ ...account, password: "weak" }).success, false);
  assert.equal(signupSchema.safeParse({ ...account, firstName: " " }).success, false);
});

test("signup keeps invitation destinations and rejects external destinations and auth loops", () => {
  assert.equal(signupDestination("/join/safe-token"), "/join/safe-token");
  assert.equal(signupDestination("/companies?view=all"), "/companies?view=all");
  for (const path of [undefined, "https://attacker.test", "//attacker.test", "/\\attacker.test", "/signup/verify", "/login?next=/signup", "/auth/callback", "/forgot-password"]) {
    assert.equal(signupDestination(path), "/workspaces/new");
  }
});

test("pending email state rejects malformed cookies and sanitizes its continuation", () => {
  for (const value of [undefined, "bad-json", "null", "{}", '{"email":"invalid","next":"/"}']) assert.equal(readPendingSignup(value), null);
  assert.deepEqual(readPendingSignup(JSON.stringify({ email: "alex@example.test", next: "//attacker.test" })), { email: "alex@example.test", next: "/workspaces/new" });
});

function fixture({ session = false, error = null, throws = false }: { session?: boolean; error?: { status: number }; throws?: boolean } = {}) {
  const writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  let sent: Record<string, unknown> | undefined;
  const exports: Record<string, (state: undefined, form?: FormData) => Promise<unknown>> = {};
  const dependencies = {
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "next/headers": { cookies: async () => ({ set: (name: string, value: string, options: Record<string, unknown>) => writes.push({ name, value, options }), get: () => undefined }) },
    "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test" } },
    "@/lib/signup": { signupSchema, signupDestination, readPendingSignup, pendingSignupCookie, pendingSignupOptions: { httpOnly: true, path: "/signup" } },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { signUp: async (input: Record<string, unknown>) => {
      if (throws) throw new Error("secret provider details");
      sent = input;
      return { data: { session: session ? {} : null }, error };
    } } }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/signup/actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: keyof typeof dependencies) => dependencies[name], Date, URL, Object });
  const form = new FormData();
  Object.entries(account).forEach(([key, value]) => form.set(key, value));
  return { form, writes, sent: () => sent, run: () => exports.signup(undefined, form), resend: () => exports.resendVerification(undefined) };
}

test("signup sends confirmation to the application and takes an unverified user to the email step", async () => {
  const f = fixture();
  f.form.set("next", "/join/team-token");
  await assert.rejects(f.run(), /redirect:\/signup\/verify/);
  assert.equal(f.writes[0].name, pendingSignupCookie);
  assert.equal(f.writes[0].options.httpOnly, true);
  assert.equal(JSON.parse(f.writes[0].value).next, "/join/team-token");
  assert.ok(!f.writes[0].value.includes(account.password));
  const options = f.sent()!.options as { emailRedirectTo: string; data: Record<string, unknown> };
  assert.equal(new URL(options.emailRedirectTo).origin, "https://crm.example.test");
  assert.equal(new URL(options.emailRedirectTo).searchParams.get("next"), "/join/team-token");
  assert.equal(options.data.display_name, "Alex Rivera");
  assert.equal(options.data.product_updates, false);
  assert.equal(options.data.terms_version, "2026-11-05");
});

test("signup with an immediate session continues to workspace creation", async () => {
  const f = fixture({ session: true });
  await assert.rejects(f.run(), /redirect:\/workspaces\/new/);
});

test("invalid signup never contacts the provider or saves a password in form state", async () => {
  const f = fixture();
  f.form.delete("terms");
  const state = await f.run();
  assert.match(JSON.stringify(state), /Accept the Terms/);
  assert.ok(!JSON.stringify(state).includes(account.password));
  assert.equal(f.sent(), undefined);
  assert.equal(f.writes.length, 0);
});

test("provider failures return safe retry guidance and preserve names and email", async () => {
  for (const options of [{ throws: true }, { error: { status: 429 } }, { error: { status: 500 } }]) {
    const f = fixture(options);
    const state = await f.run() as { error: string; firstName: string; email: string };
    assert.equal(state.firstName, account.firstName);
    assert.equal(state.email, account.email);
    assert.ok(!JSON.stringify(state).includes(account.password));
    assert.ok(!state.error.includes("secret provider details"));
    assert.equal(f.writes.length, 0);
  }
});

test("resend without pending signup returns guidance without calling the provider", async () => {
  const f = fixture();
  assert.match(JSON.stringify(await f.resend()), /Start sign-up again/);
});
