import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { loginDestination } from "../lib/login-destination.ts";

function fixture(options: { verified?: boolean; wrongUser?: boolean; wrongEmail?: boolean; providerError?: boolean } = {}) {
  const values = new Map<string, string>(), calls: unknown[] = [];
  const id = "owner-id";
  const user = { id, email: options.verified ? "existing@example.test" : null, email_confirmed_at: options.verified ? "2026-01-01" : null };
  const deps: Record<string, unknown> = {
    "next/headers": { cookies: async () => ({ get: (key: string) => values.has(key) ? { value: values.get(key) } : undefined, set: (key: string, value: string) => values.set(key, value) }) },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    zod: { z }, "@/lib/auth": { requireViewer: async () => ({ id }) }, "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } },
    "@/lib/login-destination": { loginDestination },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      getUser: async () => ({ data: { user } }),
      updateUser: async (attributes: unknown) => { calls.push(attributes); return { error: options.providerError ? { status: 429 } : null }; },
      verifyOtp: async (input: unknown) => { calls.push(input); return { data: { user: { id: options.wrongUser ? "attacker" : id, email: options.wrongEmail ? "other@example.test" : "new@example.test", email_confirmed_at: "2026-01-01" } }, error: null }; },
      signOut: async () => { calls.push("signOut"); },
    } }) },
  };
  const exports: Record<string, (...args: unknown[]) => Promise<{ error?: string; sent?: boolean }>> = {};
  const source = ts.transpileModule(readFileSync("app/auth/email/actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in deps, name); return deps[name]; }, process: { env: { NODE_ENV: "production" } }, Date, URL });
  return { api: exports, calls, values };
}
const form = (values: Record<string, string>) => { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, value); return result; };
test("new Alipay identities verify an email on their current account and never select a client-supplied user", async () => {
  const { api, calls, values } = fixture();
  const sent = await api.sendAccountEmail(undefined, form({ email: " New@Example.test ", userId: "attacker", next: "/subscribe" }));
  assert.equal(sent.sent, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { email: "new@example.test" });
  assert.equal(JSON.parse(values.get("filazoo-oauth-email")!).userId, "owner-id");
  await assert.rejects(api.confirmAccountEmail(undefined, form({ code: "12345678", next: "/subscribe" })), /redirect:\/subscribe/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { email: "new@example.test", token: "12345678", type: "email_change" });
  assert.equal(values.get("filazoo-oauth-email"), "");
});
test("email completion cannot replace an existing verified email", async () => {
  const { api, calls } = fixture({ verified: true });
  await assert.rejects(api.sendAccountEmail(undefined, form({ email: "attacker@example.test", next: "https://evil.example" })), /redirect:\/$/);
  assert.equal(calls.length, 0);
});
test("missing, expired and cross-account pending state cannot consume an email verification code", async () => {
  for (const pending of [null, { userId: "attacker", email: "new@example.test", expires: Date.now() + 60000 }, { userId: "owner-id", email: "new@example.test", expires: Date.now() - 1 }]) {
    const { api, calls, values } = fixture();
    values.set("filazoo-oauth-email", JSON.stringify(pending));
    assert.ok((await api.confirmAccountEmail(undefined, form({ code: "12345678" }))).error);
    assert.equal(calls.length, 0);
  }
});
test("OTP completion refuses an identity or email mismatch and signs out a mismatched session", async () => {
  for (const options of [{ wrongUser: true }, { wrongEmail: true }]) {
    const { api, calls } = fixture(options);
    await api.sendAccountEmail(undefined, form({ email: "new@example.test" }));
    assert.ok((await api.confirmAccountEmail(undefined, form({ code: "12345678" }))).error);
    if (options.wrongUser) assert.equal(calls.at(-1), "signOut");
  }
});
test("email rate limits do not publish pending state or claim delivery", async () => {
  const { api, values } = fixture({ providerError: true });
  assert.ok((await api.sendAccountEmail(undefined, form({ email: "new@example.test" }))).error);
  assert.equal(values.size, 0);
});
