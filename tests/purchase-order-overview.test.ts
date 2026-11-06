import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { purchaseOrderFilters, purchaseOrdersHref, orderIsOverdue, purchaseOrderSearchFilter } from "../lib/purchase-order-overview.ts";
import * as overview from "../lib/purchase-order-overview.ts";
import * as orders from "../lib/purchase-orders.ts";

test("PO filters reject malformed URL inputs and pagination preserves active filters", () => {
  for (const page of ["0", "-1", "1.5", "Infinity", "100001", "oops"]) assert.equal(purchaseOrderFilters({ page }).page, 1);
  assert.deepEqual(purchaseOrderFilters({ q: ["ignored"], status: "anything", overdue: "true", page: "2" }), { search: "", status: "", overdue: false, page: 2 });
  const filters = purchaseOrderFilters({ q: " Acme & Co ", status: "confirmed", overdue: "1", page: "2" });
  const url = new URL(purchaseOrdersHref(filters), "https://crm.test");
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: "Acme & Co", status: "confirmed", overdue: "1", page: "2" });
  assert.equal(purchaseOrderFilters({ q: "x".repeat(200) }).search.length, 100);
});

test("overdue deliveries exclude drafts and closed orders, missing dates, and today", () => {
  for (const status of orders.poStatuses) assert.equal(orderIsOverdue({ status, deliveryDate: "2026-11-05" }, "2026-11-06"), ["confirmed", "in_production", "shipped"].includes(status));
  for (const deliveryDate of ["", "2026-11-06", "2026-11-07"]) assert.equal(orderIsOverdue({ status: "confirmed", deliveryDate }, "2026-11-06"), false);
});

test("PO reference search quotes PostgREST syntax rather than allowing injected filters", () => {
  assert.equal(purchaseOrderSearchFilter('%PO,"x"(1)%', []), 'reference.ilike."%PO,\\"x\\"(1)%"');
  assert.equal(purchaseOrderSearchFilter("%Acme%", ["company-a"]), 'reference.ilike."%Acme%",company_id.in.(company-a)');
});

type Call = { table: string; method: string; args: unknown[] };
function dataModule(responses: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const client = { from(table: string) {
    const response = responses.shift();
    if (!response) throw new Error(`Unexpected query: ${table}`);
    const builder = new Proxy({}, { get(_target, method: string) {
      if (method === "then") return (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(response));
      return (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
    } });
    return builder;
  } };
  const deps: Record<string, unknown> = { "server-only": {}, "../supabase/admin": { createSupabaseAdmin: () => client }, "../purchase-orders": orders, "../purchase-order-overview": overview };
  const require = createRequire(import.meta.url);
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/purchase-orders.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name) });
  return { exports, calls };
}

test("global PO queries apply customer search, status, overdue dates and stable database pagination", async () => {
  const { exports, calls } = dataModule([{ data: [], count: 51, error: null }, { data: [{ id: "company-a" }], error: null }]);
  const result = await exports.listPurchaseOrders({ search: "Acme", status: "confirmed", overdue: true, page: 3 }, "2026-11-06") as { count: number };
  assert.equal(result.count, 51);
  assert.ok(calls.some(call => call.method === "ilike" && call.args[0] === "name" && call.args[1] === "%Acme%"));
  assert.ok(calls.some(call => call.method === "or" && call.args[0] === 'reference.ilike."%Acme%",company_id.in.(company-a)'));
  assert.ok(calls.some(call => call.method === "eq" && call.args[0] === "document->>status" && call.args[1] === "confirmed"));
  assert.ok(calls.some(call => call.method === "lt" && call.args[0] === "document->>deliveryDate" && call.args[1] === "2026-11-06"));
  assert.ok(calls.some(call => call.table === "purchase_orders" && call.method === "range" && call.args[0] === 50 && call.args[1] === 74));
  assert.ok(calls.some(call => call.table === "purchase_orders" && call.method === "order" && call.args[0] === "id"));
});

test("database failures surface instead of being displayed as an empty PO register", async () => {
  const { exports } = dataModule([{ data: null, count: null, error: { message: "Unavailable" } }]);
  await assert.rejects(() => exports.listPurchaseOrders({ search: "", status: "", overdue: false, page: 1 }, "2026-11-06"), /could not be loaded/);
});

test("stage totals use exact counts across the whole database rather than the visible page", async () => {
  const { exports, calls } = dataModule([...orders.poStatuses.map((_, index) => ({ count: index + 20, error: null })), { count: 9, error: null }]);
  const result = await exports.purchaseOrderOverview("2026-11-06") as { stages: Record<string, number>; overdue: number };
  assert.equal(result.stages.draft, 20);
  assert.equal(result.stages.cancelled, 25);
  assert.equal(result.overdue, 9);
  assert.equal(calls.filter(call => call.method === "select" && (call.args[1] as { head: boolean }).head).length, 7);
});

test("order history is scoped to the selected company and purchase order", async () => {
  const { exports, calls } = dataModule([{ data: [{ id: "event", created_at: "2026-11-06T08:00:00Z", type: "purchase_order_created", data: { summary: "PO #1006 created" } }], error: null }]);
  const activity = await exports.getPurchaseOrderActivity("order-a", "company-a") as { summary: string }[];
  assert.equal(activity[0].summary, "PO #1006 created");
  assert.ok(calls.some(call => call.table === "events" && call.method === "eq" && call.args[0] === "company_id" && call.args[1] === "company-a"));
  assert.ok(calls.some(call => call.method === "contains" && (call.args[1] as { purchaseOrderId: string }).purchaseOrderId === "order-a"));
  assert.ok(calls.some(call => call.method === "limit" && call.args[0] === 30));
});
