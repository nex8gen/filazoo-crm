import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { erpSettingsSchema, publicCrmOrigin, settingsConfig } from "../lib/erp-settings.ts";
import * as lingxing from "../lib/lingxing.ts";

const input = { name: "Warehouse stock", appId: "1234567890123456", appSecret: "new-secret", warehouseIds: "1,2", mappings: [{ crmSku: "CRM-BLACK", erpSku: "ERP-BLACK" }], enabled: true, syncInterval: 15 as const, revision: 1, appUrl: "https://crm.example.com" };

test("settings validate schedules, warehouses and one-to-one CRM aliases", () => {
  assert.equal(erpSettingsSchema.safeParse(input).success, true);
  for (const change of [{ syncInterval: 1 }, { warehouseIds: "1,not-an-id" }, { appId: "bad" }, { mappings: [input.mappings[0], input.mappings[0]] }, { appUrl: "http://localhost:3000" }]) assert.equal(erpSettingsSchema.safeParse({ ...input, ...change }).success, false);
  assert.equal(erpSettingsSchema.safeParse({ ...input, syncInterval: 0, appUrl: "http://localhost:3000" }).success, true);
  assert.equal(erpSettingsSchema.safeParse({ ...input, enabled: false, appUrl: "http://localhost:3000" }).success, true);
});

test("automatic workers accept a public HTTPS CRM origin without credentials, ports or paths", () => {
  for (const value of ["http://crm.example.com", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://myapp.internal", "https://user:pass@crm.example.com", "https://crm.example.com/path", "https://crm.example.com?key=secret", "https://crm.example.com:444"]) assert.equal(publicCrmOrigin(value), null);
  assert.equal(publicCrmOrigin("https://crm.example.com/"), "https://crm.example.com");
});

test("blank secrets only preserve a saved secret for the same App ID", () => {
  const saved = { appId: input.appId, appSecret: "saved-secret" };
  const result = settingsConfig({ ...input, appSecret: "" }, saved);
  assert.equal(result.appSecret, "saved-secret");
  assert.equal(result.skuMap["CRM-BLACK"], "ERP-BLACK");
  assert.throws(() => settingsConfig({ ...input, appId: "6543210987654321", appSecret: "" }, saved), /Enter the App Secret/);
  assert.throws(() => settingsConfig({ ...input, appSecret: "" }, null), /Enter the App Secret/);
  assert.equal(settingsConfig(input, saved).appSecret, "new-secret");
});

function actions(role: string | null, origin = input.appUrl, databaseError: { code: string } | null = null) {
  const calls: { name: string; input: unknown }[] = [];
  const paths: string[] = [];
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "next/headers": { headers: async () => new Headers({ origin }) },
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "node:net": { isIP: () => 0 },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!role || !roles.includes(role)) throw new Error("Access denied"); return { id: "admin-id" }; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ rpc: async (name: string, values: unknown) => { calls.push({ name, input: values }); return { data: 2, error: databaseError }; } }) },
    "@/lib/data/erp-settings": { readErpConnection: async () => ({ app_id: input.appId, app_secret: "saved-secret" }) },
    "@/lib/erp-settings": { erpSettingsSchema, publicCrmOrigin, settingsConfig },
    "@/lib/lingxing": { ...lingxing, testLingxingConnection: async () => 5, listLingxingWarehouses: async () => [{ id: "1", name: "Main", type: "local" }] },
  };
  const source = ts.transpileModule(readFileSync(new URL("../app/settings/erp-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Headers, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; } });
  return { exports: exports as unknown as typeof import("../app/settings/erp-actions.ts"), calls, paths };
}

test("every ERP configuration action rejects non-administrators before access", async () => {
  for (const role of [null, "operator", "bd_manager", "viewer"]) {
    const action = actions(role);
    for (const name of ["saveErpConnection", "testErpConnection", "loadErpWarehouses"] as const) await assert.rejects(() => action.exports[name](input), /Access denied/);
    await assert.rejects(() => action.exports.detectErpServerIp(), /Access denied/);
    assert.equal(action.calls.length, 0);
  }
});

test("saving atomically configures credentials, SKU aliases and automatic cadence without returning a secret", async () => {
  const action = actions("admin");
  const result = await action.exports.saveErpConnection({ ...input, appSecret: "" });
  assert.equal(result.ok, true);
  const call = action.calls[0].input as Record<string, unknown>;
  assert.equal(call.p_app_secret, "saved-secret");
  assert.equal(call.p_worker_url, `${input.appUrl}/api/cron/inventory`);
  assert.equal(call.p_sync_interval, 15);
  assert.equal(call.p_updated_by, "admin-id");
  assert.equal(JSON.stringify(call.p_sku_map), '{"CRM-BLACK":"ERP-BLACK"}');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  assert.deepEqual(action.paths, ["/settings/erp", "/catalogs"]);
});

test("forged worker origins, invalid fields and stale edits never save silently", async () => {
  const forged = actions("admin", "https://real-crm.example.com");
  assert.equal((await forged.exports.saveErpConnection(input)).ok, false);
  assert.equal(forged.calls.length, 0);
  const invalid = actions("admin");
  assert.equal((await invalid.exports.saveErpConnection({ ...input, mappings: [input.mappings[0], input.mappings[0]] })).ok, false);
  assert.equal(invalid.calls.length, 0);
  const stale = actions("admin", input.appUrl, { code: "40001" });
  const result = await stale.exports.saveErpConnection(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /another session/);
  assert.deepEqual(stale.paths, []);
});

test("testing and warehouse discovery use unsaved credentials without saving or syncing", async () => {
  const action = actions("admin");
  assert.equal((await action.exports.testErpConnection({ ...input, appUrl: "http://localhost:3000" })).ok, true);
  const result = await action.exports.loadErpWarehouses(input);
  assert.equal(result.ok, true);
  assert.equal(action.calls.length, 0);
  assert.deepEqual(action.paths, []);
});

test("connection testing verifies inventory permission with one row; warehouse discovery covers local and overseas", async () => {
  const config = settingsConfig(input, null);
  const seen: Record<string, unknown>[] = [];
  const fetcher = (async (url, init) => {
    if (String(url).includes("access-token")) return Response.json({ code: 200, data: { access_token: "token" } });
    const body = JSON.parse(String(init?.body)); seen.push(body);
    if (String(url).includes("inventoryDetails")) return Response.json({ code: 0, data: [], total: 0 });
    return Response.json({ code: 0, data: [{ wid: body.type, name: body.type === 1 ? "Local" : "Overseas" }], total: 1 });
  }) as typeof fetch;
  assert.equal(await lingxing.testLingxingConnection(config, fetcher), 0);
  assert.equal(seen[0].length, 1);
  assert.equal(seen[0].wid, "1,2");
  assert.deepEqual(await lingxing.listLingxingWarehouses(config, fetcher), [{ id: "1", name: "Local", type: "local" }, { id: "3", name: "Overseas", type: "overseas" }]);
  assert.deepEqual(seen.slice(1).map(item => item.type), [1,3]);
});

test("the Settings projection never returns a saved secret and pausing overrides environment credentials", async () => {
  let enabled = true;
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL("../lib/data/erp-settings.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps: Record<string, unknown> = {
    "server-only": {}, "react": { cache: (fn: unknown) => fn },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: async () => ({ error: null, data: { name: "Saved ERP", app_id: input.appId, app_secret: "never-serialize-this-secret", warehouse_ids: ["1"], sku_map: { CRM: "ERP" }, enabled, sync_interval: 15, revision: 2, last_dispatch_error: null } }) }) },
    "../auth.ts": { requireWorkspaceMember: async () => ({ role: "admin" }) },
    "../env.ts": { hasSupabaseConfig: () => true },
    "../lingxing.ts": lingxing,
  };
  vm.runInNewContext(source, { exports, require: (name: string) => { if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`); return deps[name]; } });
  const api = exports as unknown as typeof import("../lib/data/erp-settings.ts");
  const view = await api.getErpSettingsView();
  assert.equal(view.hasSecret, true);
  assert.doesNotMatch(JSON.stringify(view), /never-serialize|app_secret|appSecret|worker_secret/);
  assert.equal((await api.configuredErp())?.appSecret, "never-serialize-this-secret");
  enabled = false;
  assert.equal(await api.configuredErp(), null);
});
