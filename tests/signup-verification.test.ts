import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { isStandaloneRoute } from "../lib/standalone-routes.ts";
import { pendingSignupCookie, pendingSignupOptions, readPendingSignup, signupDestination } from "../lib/signup.ts";

test("all signup and workspace onboarding steps bypass the CRM shell, including nested routes", () => {
  for (const path of ["/signup", "/signup/verify", "/signup/verify/", "/workspaces", "/workspaces/new", "/workspaces/setup", "/auth/error", "/join/invitation", "/customer/invoices/123"]) assert.equal(isStandaloneRoute(path), true, path);
  for (const path of ["/", "/analytics", "/email", "/settings", "/signup-other", "/workspaces-other", "/customers"]) assert.equal(isStandaloneRoute(path), false, path);
});

function fixture({ pending = { email: "alex@example.test", next: "/join/team-token" } as { email: string; next: string } | null, error = null as { status?: number; code?: string } | null, session = true, throws = false } = {}) {
  const calls: Record<string, unknown>[] = [];
  const writes: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const exports: Record<string, (state: undefined, data: FormData) => Promise<{ error?: string; success?: string }>> = {};
  const dependencies = {
    zod: { z },
    "next/headers": { cookies: async () => ({ get: () => pending ? { value: JSON.stringify(pending) } : undefined, set: (name: string, value: string, options: Record<string, unknown>) => writes.push({ name, value, options }) }) },
    "next/navigation": { redirect: (destination: string) => { throw new Error(`redirect:${destination}`); } },
    "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test" } },
    "@/lib/signup": { pendingSignupCookie, pendingSignupOptions, readPendingSignup, signupDestination },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      verifyOtp: async (input: Record<string, unknown>) => {
        calls.push(input); if (throws) throw new Error("private provider details");
        return { data: { session: session ? { access_token: "private-test-token" } : null, user: session ? { id: "verified-user" } : null }, error };
      },
      resend: async (input: Record<string, unknown>) => { calls.push(input); return { error }; },
    } }) },
  };
  const source = readFileSync(new URL("../app/signup/verify/actions.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: keyof typeof dependencies) => dependencies[name], URL, Object });
  const form = new FormData(); form.set("code", "01234567");
  return { calls, writes, form, verify: () => exports.verifySignupCode(undefined, form), request: () => exports.requestVerification(undefined, form) };
}

test("verification checks the exact code and pending email, clears the pending cookie and preserves invitations", async () => {
  const f = fixture(); f.form.set("email", "forged@example.test");
  await assert.rejects(f.verify(), /redirect:\/join\/team-token/);
  assert.equal(f.calls[0].email, "alex@example.test");
  assert.equal(f.calls[0].token, "01234567");
  assert.equal(f.calls[0].type, "email");
  assert.equal(f.writes[0].name, pendingSignupCookie);
  assert.equal(f.writes[0].value, "");
  assert.equal(f.writes[0].options.path, "/signup");
  assert.equal(f.writes[0].options.maxAge, 0);
});

test("malformed or missing codes never reach the authentication provider", async () => {
  for (const code of ["", "12345", "12345678901", "ABCDEF", "12 345", "１２３４５６"]) {
    const f = fixture(); f.form.set("code", code);
    assert.match((await f.verify()).error!, /verification code/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes.length, 0);
  }
});

test("the verifier preserves provider-supported code lengths including this project's eight digits", async () => {
  for (const code of ["012345", "01234567", "0123456789"]) {
    const f = fixture(); f.form.set("code", code);
    await assert.rejects(f.verify(), /redirect:\/join\/team-token/);
    assert.equal(f.calls[0].token, code);
  }
});

test("expired, incorrect and replayed codes cannot create a verified session", async () => {
  for (const options of [{ error: { status: 403, code: "otp_expired" } }, { error: { status: 400 } }, { session: false }]) {
    const f = fixture(options);
    assert.match((await f.verify()).error!, /invalid or has expired/);
    assert.equal(f.writes.length, 0);
  }
});

test("verification rate limits and provider outages offer safe retry guidance", async () => {
  const limited = fixture({ error: { status: 429 } });
  assert.match((await limited.verify()).error!, /Too many attempts/);
  const unavailable = fixture({ throws: true });
  const state = await unavailable.verify();
  assert.match(state.error!, /temporarily unavailable/);
  assert.ok(!JSON.stringify(state).includes("private"));
  assert.equal(unavailable.writes.length, 0);
});

test("verification supports a restored session without pending cookies and rejects external continuations", async () => {
  const f = fixture({ pending: null });
  f.form.set("email", " ALEX@example.test "); f.form.set("next", "//attacker.test");
  await assert.rejects(f.verify(), /redirect:\/workspaces\/new/);
  assert.equal(f.calls[0].email, "alex@example.test");
});

test("resending a code preserves the continuation and applies provider rate limits", async () => {
  const f = fixture(); f.form.set("email", "alex@example.test"); f.form.set("next", "/join/team-token");
  assert.match((await f.request()).success!, /new code/);
  assert.equal(f.calls[0].type, "signup");
  assert.equal(JSON.parse(f.writes[0].value).next, "/join/team-token");
  const limited = fixture({ error: { status: 429 } }); limited.form.set("email", "alex@example.test");
  assert.match((await limited.request()).error!, /wait a minute/);
  assert.equal(limited.writes.length, 0);
});

test("the confirmation email template contains an OTP instead of a sign-in link", () => {
  const template = readFileSync(new URL("../supabase/templates/confirmation.html", import.meta.url), "utf8");
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /ConfirmationURL|TokenHash/);
});
