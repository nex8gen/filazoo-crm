import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const current = "bb000001-1111-4111-8111-000000000001";
const other = "bb000001-1111-4111-8111-000000000002";
function actions(options: { signedIn?: boolean; pendingMfa?: boolean; fail?: boolean } = {}) {
  const calls: { name: string; args: unknown }[] = [], signouts: unknown[] = [];
  const exports: Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>> = {};
  const dependencies: Record<string, unknown> = {
    zod: { z }, "next/cache": { revalidatePath: () => {} },
    "@/lib/auth": { requireViewer: async () => { if (options.signedIn === false) throw new Error("Sign in"); } },
    "@/lib/account-security-server": {
      readAccountSecurity: async () => ({ userId: "verified-account", sessionId: current, requiresMfa: options.pendingMfa, client: { auth: { signOut: async (scope: unknown) => { signouts.push(scope); } } } }),
      readDeviceSessions: async () => [{ id: current }],
    },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { error: options.fail ? { message: "private database failure" } : null }; } }) },
  };
  const source = ts.transpileModule(readFileSync(new URL("../app/settings/security-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name] });
  return { api: exports, calls, signouts };
}

test("session actions reject unauthenticated requests, malformed IDs and injected ownership", async () => {
  const unsigned = actions({ signedIn: false });
  await assert.rejects(unsigned.api.revokeDeviceSessions({ scope: "all" }), /Sign in/);
  await assert.rejects(unsigned.api.loadDeviceSessions(), /Sign in/);
  assert.equal(unsigned.calls.length, 0);
  const f = actions();
  for (const input of [{ scope: "one", id: "bad" }, { scope: "all", userId: "other-account" }, { scope: "others", sessionId: other }, { scope: "invalid" }]) assert.ok((await f.api.revokeDeviceSessions(input)).error);
  assert.equal(f.calls.length, 0);
});

test("revocation always binds verified ownership and leaves the current device signed in for other-device actions", async () => {
  const f = actions(); const result = await f.api.revokeDeviceSessions({ scope: "one", id: other });
  assert.equal(result.signedOut, false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ name: "revoke_account_sessions", args: { p_user_id: "verified-account", p_session_id: current, p_scope: "one", p_target_id: other } }]);
  assert.equal(f.signouts.length, 0);
});

test("revoking the current device or all devices also clears the local auth session", async () => {
  for (const input of [{ scope: "all" }, { scope: "one", id: current }]) {
    const f = actions(); const result = await f.api.revokeDeviceSessions(input);
    assert.equal(result.signedOut, true);
    assert.equal(JSON.stringify(f.signouts), JSON.stringify([{ scope: "local" }]));
  }
});

test("pending MFA and failed revocations do not report success or clear cookies", async () => {
  const pending = actions({ pendingMfa: true }); assert.ok((await pending.api.revokeDeviceSessions({ scope: "all" })).error); assert.equal(pending.calls.length, 0);
  const failed = actions({ fail: true }); const result = await failed.api.revokeDeviceSessions({ scope: "all" });
  assert.ok(result.error); assert.equal(result.success, undefined); assert.equal(failed.signouts.length, 0);
  assert.doesNotMatch(String(result.error), /private database failure/);
});

test("server authentication records the request's browser label without forwarding unrelated headers", async () => {
  const exports: { createClient?: () => Promise<{ global: { headers: Record<string, string> } }> } = {};
  const dependencies: Record<string, unknown> = {
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, options: unknown) => options },
    "next/server": { connection: async () => {} },
    "../env.ts": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", supabasePublishableKey: "public" } },
    "./auth-fetch.ts": { authFetch: () => fetch },
    "next/headers": { cookies: async () => ({ getAll: () => [], set: () => {} }), headers: async () => new Headers({ "user-agent": "Chrome / Windows", authorization: "untrusted", "x-forwarded-for": "spoofed" }) },
  };
  const source = ts.transpileModule(readFileSync(new URL("../lib/supabase/server.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name], Headers });
  const result = await exports.createClient!();
  assert.equal(JSON.stringify(result.global.headers), JSON.stringify({ "User-Agent": "Chrome / Windows" }));
});
