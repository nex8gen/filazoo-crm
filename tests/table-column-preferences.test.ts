import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as columns from "../lib/table-column-preferences.ts";

test("saved choices restore independently for every table, including show all", () => {
  const restored = columns.readTableColumnPreferences({
    crm_table_columns_companies: {},
    "crm_table_columns_meta-leads": { sourceIds: true },
    "crm_table_columns_purchase-orders": { total: false, delivery: true },
    "crm_table_columns_purchase-order-drafts": { customer: false },
  });
  assert.deepEqual(restored, {
    companies: {}, "meta-leads": { sourceIds: true },
    "purchase-orders": { total: false, delivery: true }, "purchase-order-drafts": { customer: false },
  });
  assert.deepEqual(columns.readTableColumnPreferences(null), columns.defaultTableColumns);
  assert.deepEqual(columns.readTableColumnPreferences({ crm_table_columns_companies: { email: "false" }, "crm_table_columns_meta-leads": { sourceIds: true } }), {
    ...columns.defaultTableColumns, "meta-leads": { sourceIds: true },
  });
});

test("rapid functional toggles save in order, survive remounts, and stay isolated by account", async () => {
  const metadata: Record<string, unknown> = {};
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writes: columns.ColumnVisibility[] = [];
  const store = columns.createTableColumnStore(columns.readTableColumnPreferences(metadata), async input => {
    writes.push(input.visibility);
    if (writes.length === 1) await gate;
    metadata[columns.tableColumnMetadataKey(input.tableId)] = input.visibility;
    return {};
  }, assert.fail);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  const first = store.write("companies", current => ({ ...current, email: false }));
  const last = store.write("companies", current => ({ ...current, country: false }));
  assert.equal(store.read("companies").country, false);
  await Promise.resolve();
  assert.equal(writes.length, 1);
  release();
  await Promise.all([first, last]);
  assert.equal(notifications, 2);
  unsubscribe();
  const returningUser = columns.readTableColumnPreferences(metadata);
  assert.deepEqual(returningUser.companies, { addedAt: false, email: false, country: false });
  const otherUser = columns.createTableColumnStore(columns.readTableColumnPreferences({}), async () => ({}), assert.fail);
  assert.deepEqual(otherUser.read("companies"), { addedAt: false });
  assert.equal(returningUser["meta-leads"].sourceIds, false);
});

test("failed saves roll back to the last confirmed choices and subsequent saves still work", async () => {
  const errors: string[] = [];
  let fail = false;
  const store = columns.createTableColumnStore(columns.readTableColumnPreferences(null), async () => {
    if (fail) throw new Error("offline");
    return {};
  }, message => errors.push(message));
  await store.write("companies", { email: false });
  fail = true;
  await store.write("companies", { country: false });
  assert.deepEqual(store.read("companies"), { email: false });
  assert.equal(errors.length, 1);
  fail = false;
  await store.write("companies", {});
  assert.deepEqual(store.read("companies"), {});
});

test("a failed earlier save cannot roll back a newer selection", async () => {
  let count = 0;
  const store = columns.createTableColumnStore(columns.readTableColumnPreferences(null), async () => {
    return ++count === 1 ? { error: "unavailable" } : {};
  }, () => {});
  void store.write("companies", { email: false });
  await store.write("companies", { email: false, country: false });
  assert.deepEqual(store.read("companies"), { email: false, country: false });
});

function actionFixture({ authenticated = true, failed = false } = {}) {
  const writes: unknown[] = [];
  const exports: { saveTableColumns?: (input: unknown) => Promise<{ error?: string }> } = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/table-column-actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => { if (!authenticated) throw new Error("unauthenticated"); return { id: "current-user", role: "viewer" }; } },
    "@/lib/table-column-preferences": columns,
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      updateUser: async (input: unknown) => { writes.push(input); return { error: failed ? { message: "unavailable" } : null }; },
    } }) },
  };
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] });
  return { save: exports.saveTableColumns!, writes };
}

test("saving uses only the authenticated account and one table's metadata key", async () => {
  const mock = actionFixture();
  assert.equal((await mock.save({ tableId: "companies", visibility: { email: false } })).error, undefined);
  assert.equal(JSON.stringify(mock.writes), JSON.stringify([{ data: { crm_table_columns_companies: { email: false } } }]));
  assert.equal((await mock.save({ tableId: "companies", visibility: {} })).error, undefined);
});

test("invalid choices and attempts to select another user never reach storage", async () => {
  const mock = actionFixture();
  for (const input of [
    { tableId: "companies", visibility: {}, userId: "someone-else" },
    { tableId: "unknown", visibility: {} },
    { tableId: "companies", visibility: { email: "false" } },
    { tableId: "companies", visibility: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`column${index}`, false])) },
  ]) assert.ok((await mock.save(input)).error);
  assert.equal(mock.writes.length, 0);
  const unauthenticated = actionFixture({ authenticated: false });
  await assert.rejects(unauthenticated.save({ tableId: "companies", visibility: {} }));
  assert.equal(unauthenticated.writes.length, 0);
  assert.ok((await actionFixture({ failed: true }).save({ tableId: "companies", visibility: {} })).error);
});
