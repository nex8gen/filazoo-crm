import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { isAvatarPreset } from "../lib/profile-avatar.ts";
import { readUserPreferences } from "../lib/user-preferences.ts";

const id = "aaaaaaaa-1111-2222-3333-444444444444";
const sessionId = "bbbbbbbb-1111-2222-3333-444444444444";
const claims = { sub: id, session_id: sessionId, aud: "authenticated", role: "authenticated", iss: "https://test.supabase.co/auth/v1", user_metadata: { avatar_preset: "male", role: "admin" } };
const member = { id, email: "staff@example.com", user_metadata: { avatar_preset: "female" }, role: "operator", display_name: "Staff", activated_at: "2026-01-01" };
const source = ts.transpileModule(readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
type Options = { claims?: unknown; claimError?: unknown; row?: unknown; rpcError?: { code: string; message: string }; cache?: boolean; legacySignedIn?: boolean };
function load(options: Options = {}) {
  const calls = { claims: 0, rpc: 0, getUser: 0, membership: 0 };
  const state = { claims: "claims" in options ? options.claims : claims, row: "row" in options ? options.row : member };
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const deps: Record<string, unknown> = {
    react: { cache: (fn: () => unknown) => { let value: unknown; let called = false; return () => { if (!options.cache) return fn(); if (!called) { value = fn(); called = true; } return value; }; } },
    "./env.ts": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" }, hasSupabaseAuthConfig: () => true, hasSupabaseConfig: () => true },
    "./profile-avatar.ts": { isAvatarPreset }, "./user-preferences.ts": { readUserPreferences },
    "next/server": { connection: async () => {} }, "next/navigation": { redirect: (path: string) => { throw new Error(path); } },
    "./supabase/server.ts": { createClient: async () => ({ auth: {
      getClaims: async () => { calls.claims++; return { data: state.claims ? { claims: state.claims } : null, error: options.claimError ?? null }; },
      getUser: async () => { calls.getUser++; return { data: { user: options.legacySignedIn === false ? null : member }, error: null }; },
    } }) },
    "./supabase/admin.ts": { createSupabaseAdmin: () => ({
      rpc: (name: string, params: unknown) => { calls.rpc++; assert.equal(name, "read_crm_session"); assert.deepEqual(JSON.parse(JSON.stringify(params)), { p_user_id: id, p_session_id: sessionId }); return { maybeSingle: async () => ({ data: state.row, error: options.rpcError ?? null }) }; },
      from: (table: string) => { calls.membership++; assert.equal(table, "workspace_members"); const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: state.row, error: null }) }; return query; },
    }) },
  };
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in deps, name); return deps[name]; }, Set });
  return { api: exports, calls, state };
}

test("valid signed identity and live membership require one backend snapshot and no Auth user call", async () => {
  const { api, calls } = load();
  const viewer = await api.requireWorkspaceMember(["operator"]) as { role: string; avatarPreset: string };
  assert.equal(viewer.role, "operator");
  assert.equal(viewer.avatarPreset, "female"); // Fresh DB metadata, not stale JWT metadata.
  assert.deepEqual(calls, { claims: 1, rpc: 1, getUser: 0, membership: 0 });
});

test("invalid, tampered, missing, or wrong-project claims cannot reach the privileged reader", async () => {
  for (const identity of [null, { ...claims, sub: "bad" }, { ...claims, session_id: "" }, { ...claims, session_id: "other-user" }, { ...claims, aud: "service_role" }, { ...claims, role: "service_role" }, { ...claims, iss: "https://other.supabase.co/auth/v1" }]) {
    const { api, calls } = load({ claims: identity });
    await assert.rejects(api.requireWorkspaceMember(), /\/login/);
    assert.equal(calls.rpc, 0); assert.equal(calls.getUser, 0);
  }
  const rejected = load({ claimError: new Error("Invalid signature or expired JWT") });
  assert.equal(await rejected.api.getViewer(), null);
  assert.equal(rejected.calls.rpc, 0);
});

test("revoked sessions, banned/deleted users, and identity mismatches fail closed without legacy fallback", async () => {
  for (const row of [null, { ...member, id: "cccccccc-1111-2222-3333-444444444444" }]) {
    const { api, calls } = load({ row });
    await assert.rejects(api.requireWorkspaceMember(), /\/login/);
    assert.equal(calls.rpc, 1); assert.equal(calls.getUser, 0);
  }
});

test("inactive, missing or unknown roles and denied operations cannot inherit JWT metadata roles", async () => {
  for (const row of [{ ...member, activated_at: null }, { ...member, role: null }, { ...member, role: "superuser" }, member]) {
    const { api } = load({ row });
    await assert.rejects(api.requireWorkspaceMember(["admin"]), /\/access-denied/);
  }
  const { api } = load({ row: { ...member, role: null, activated_at: null } });
  assert.equal((await api.requireViewer() as { id: string }).id, id); // Invitation/account activation flow.
  assert.equal(await api.getWorkspaceViewer(), null);
});

test("live role or session changes are observed on the next non-render request", async () => {
  const { api, calls, state } = load();
  await api.requireWorkspaceMember(["operator"]);
  state.row = { ...member, role: "viewer" };
  await assert.rejects(api.requireWorkspaceMember(["operator"]), /\/access-denied/);
  state.row = null;
  await assert.rejects(api.requireWorkspaceMember(), /\/login/);
  assert.equal(calls.rpc, 3);
});

test("render-scoped memoization shares a snapshot between shell, page and data helpers", async () => {
  const { api, calls } = load({ cache: true });
  await Promise.all([api.getViewer(), api.getWorkspaceViewer(), api.requireWorkspaceMember(["operator"])]);
  assert.deepEqual(calls, { claims: 1, rpc: 1, getUser: 0, membership: 0 });
});

test("only an uninstalled migration uses the original live Auth and membership checks", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const { api, calls } = load({ rpcError: { code, message: "Function missing" } });
    await api.requireWorkspaceMember(["operator"]);
    assert.deepEqual(calls, { claims: 1, rpc: 1, getUser: 1, membership: 1 });
  }
  const { api, calls } = load({ rpcError: { code: "PGRST202", message: "Function missing" }, legacySignedIn: false });
  await assert.rejects(api.requireWorkspaceMember(), /\/login/);
  assert.equal(calls.membership, 0);
});

test("database outages and permission errors cannot become successful authorization", async () => {
  for (const code of ["42501", "PGRST301", "57014", "ECONNRESET"]) {
    const { api, calls } = load({ rpcError: { code, message: "Unavailable" } });
    await assert.rejects(api.requireWorkspaceMember(), /Workspace session lookup failed/);
    assert.equal(calls.getUser, 0);
  }
});
