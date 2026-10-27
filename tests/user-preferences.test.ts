import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../lib/user-preferences.ts";

test("preferences preserve valid saved fields and repair invalid or missing fields", () => {
  assert.deepEqual(preferences.readUserPreferences(null), preferences.defaultUserPreferences);
  const saved = preferences.readUserPreferences({ emailSignature: "  Sales team  ", tablePageSize: 100, emailSyncSeconds: -1, emailMarkRead: false });
  assert.equal(saved.tablePageSize, 100);
  assert.equal(saved.emailSignature, "Sales team");
  assert.equal(saved.emailMarkRead, false);
  assert.equal(saved.emailSyncSeconds, 15);
  for (const input of [{ tablePageSize: 1000 }, { emailSyncSeconds: 1 }, { emailSignature: "x".repeat(2001) }, { emailMarkRead: "true" }]) {
    assert.equal(preferences.userPreferencesSchema.safeParse(input).success, false);
  }
});

test("signatures append once, support multiline text, and leave unsigned messages alone", () => {
  assert.equal(preferences.withEmailSignature(" Hello ", " Sales\nFilazoo "), "Hello\n\nSales\nFilazoo");
  assert.equal(preferences.withEmailSignature("Hello\n\nSales", "Sales"), "Hello\n\nSales");
  assert.equal(preferences.withEmailSignature(" Hello ", "  "), "Hello");
});

function fixture(options: { authenticated?: boolean; error?: boolean } = {}) {
  const writes: unknown[] = [];
  const scopes: unknown[] = [];
  const paths: unknown[] = [];
  const exports: Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/settings/preference-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: (...args: unknown[]) => paths.push(args) },
    "@/lib/auth": { requireWorkspaceMember: async () => { if (options.authenticated === false) throw new Error("unauthenticated"); return { id: "current-user", role: "viewer" }; } },
    "@/lib/user-preferences": preferences,
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      updateUser: async (input: unknown) => { writes.push(input); return { error: options.error ? { message: "unavailable" } : null }; },
      signOut: async (input: unknown) => { scopes.push(input); return { error: options.error ? { message: "unavailable" } : null }; },
    } }) },
  };
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] });
  return { actions: exports, writes, scopes, paths };
}

test("saving preferences updates only the current account metadata and invalidates layouts", async () => {
  const mock = fixture();
  const input = { ...preferences.defaultUserPreferences, emailSignature: "Sales", emailSyncSeconds: 0 };
  assert.equal(JSON.stringify(await mock.actions.saveUserPreferences(input)), JSON.stringify({ preferences: input }));
  assert.equal(JSON.stringify(mock.writes), JSON.stringify([{ data: { crm_preferences: input } }]));
  assert.equal(JSON.stringify(mock.paths), JSON.stringify([["/", "layout"]]));
});

test("invalid or unauthenticated settings writes do not reach storage", async () => {
  const invalid = fixture();
  assert.ok((await invalid.actions.saveUserPreferences({ ...preferences.defaultUserPreferences, role: "admin" })).error);
  assert.equal(invalid.writes.length, 0);
  const unauthenticated = fixture({ authenticated: false });
  await assert.rejects(unauthenticated.actions.saveUserPreferences(preferences.defaultUserPreferences));
  await assert.rejects(unauthenticated.actions.signOutOtherSessions());
  assert.equal(unauthenticated.writes.length + unauthenticated.scopes.length, 0);
});

test("failed saves never report success or invalidate cached preferences", async () => {
  const mock = fixture({ error: true });
  assert.ok((await mock.actions.saveUserPreferences(preferences.defaultUserPreferences)).error);
  assert.equal(mock.paths.length, 0);
  assert.ok((await mock.actions.signOutOtherSessions()).error);
});

test("other-device signout keeps the current session", async () => {
  const mock = fixture();
  assert.ok((await mock.actions.signOutOtherSessions()).success);
  assert.equal(JSON.stringify(mock.scopes), JSON.stringify([{ scope: "others" }]));
});
