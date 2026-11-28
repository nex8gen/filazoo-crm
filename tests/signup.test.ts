import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { signupSchema, signupDestination, readPendingSignup, pendingSignupCookie } from "../lib/signup.ts";

const account = { firstName: " Alex ", lastName: " Rivera ", companyName: " Acme Studio ", email: " ALEX@example.test ", password: "SafePassword123!", terms: "on" };

test("public signup validates identity, password and consent without requiring workspace membership", () => {
  const parsed = signupSchema.parse(account);
  assert.equal(parsed.firstName, "Alex");
  assert.equal(parsed.lastName, "Rivera");
  assert.equal(parsed.companyName, "Acme Studio");
  assert.equal(parsed.email, "alex@example.test");
  assert.equal(signupSchema.safeParse({ ...account, terms: undefined }).success, false);
  assert.equal(signupSchema.safeParse({ ...account, password: "weak" }).success, false);
  assert.equal(signupSchema.safeParse({ ...account, firstName: " " }).success, false);
  for (const companyName of [undefined, "", " ", "A", "A".repeat(81)]) assert.equal(signupSchema.safeParse({ ...account, companyName }).success, false);
});

test("signup keeps invitation destinations and rejects external destinations and auth loops", () => {
  assert.equal(signupDestination("/join/safe-token"), "/join/safe-token");
  assert.equal(signupDestination("/companies?view=all"), "/companies?view=all");
  for (const path of [undefined, "https://attacker.test", "//attacker.test", "/\\attacker.test", "/signup/verify", "/login?next=/signup", "/auth/callback", "/forgot-password"]) {
    assert.equal(signupDestination(path), "/subscribe");
  }
});

test("pending email state rejects malformed cookies and sanitizes its continuation", () => {
  for (const value of [undefined, "bad-json", "null", "{}", '{"email":"invalid","next":"/"}']) assert.equal(readPendingSignup(value), null);
  assert.deepEqual(readPendingSignup(JSON.stringify({ email: "alex@example.test", next: "//attacker.test" })), { email: "alex@example.test", next: "/subscribe" });
});

function fixture({ session = false, error = null, throws = false, user = { id: "new-user", identities: [{ provider: "email" }] } }: { session?: boolean; error?: { status: number; code?: string } | null; throws?: boolean; user?: { id: string; identities?: { provider: string }[]; invited_at?: string } | null } = {}) {
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
      return { data: { session: session ? {} : null, user }, error };
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
  assert.equal(options.data.company_name, "Acme Studio");
  assert.equal(options.data.product_updates, false);
  assert.equal(options.data.terms_version, "2026-11-05");
});

test("signup with an immediate session continues to workspace creation", async () => {
  const f = fixture({ session: true });
  await assert.rejects(f.run(), /redirect:\/subscribe/);
});

test("existing accounts receive sign-in guidance rather than a pending verification screen", async () => {
  for (const options of [
    { user: { id: "masked-user", identities: [] } },
    { user: { id: "masked-invited-user", identities: [], invited_at: "2026-11-01T00:00:00Z" } },
    { error: { status: 422, code: "user_already_exists" } },
    { error: { status: 422, code: "email_exists" } },
  ]) {
    const f = fixture(options);
    const state = await f.run() as { error: string; existingAccount: boolean; next: string; email: string };
    assert.equal(state.existingAccount, true);
    assert.match(state.error, /Sign in to create a new workspace/);
    assert.equal(state.next, "/workspaces/new");
    assert.equal(state.email, "alex@example.test");
    assert.ok(!JSON.stringify(state).includes(account.password));
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].value, "");
    assert.equal(f.writes[0].options.maxAge, 0);
  }
});

test("existing accounts preserve workspace creation and invitation continuations", async () => {
  for (const next of ["/workspaces/new", "/join/team-token", "/subscribe?new=1&plan=team"]) {
    const f = fixture({ user: { id: "masked-user", identities: [] } });
    f.form.set("next", next);
    const state = await f.run() as { next: string; error: string };
    assert.equal(state.next, next);
    if (next.startsWith("/join/")) assert.match(state.error, /Sign in to join your team/);
  }
});

test("an immediate session is not treated as a masked duplicate signup", async () => {
  const signedIn = fixture({ session: true, user: { id: "signed-in-user", identities: [] } });
  signedIn.form.set("next", "/workspaces/new");
  await assert.rejects(signedIn.run(), /redirect:\/workspaces\/new/);
});

test("an incomplete provider response cannot claim that a verification email was sent", async () => {
  const f = fixture({ user: null });
  assert.match(JSON.stringify(await f.run()), /temporarily unavailable/);
  assert.equal(f.writes.length, 0);
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
    const state = await f.run() as { error: string; firstName: string; companyName: string; email: string };
    assert.equal(state.firstName, account.firstName);
    assert.equal(state.companyName, account.companyName);
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
