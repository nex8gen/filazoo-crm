import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { purchaseOrderFilters, purchaseOrdersHref, orderIsOverdue, purchaseOrderSearchFilter } from "../lib/purchase-order-overview.ts";
import * as overview from "../lib/purchase-order-overview.ts";
import * as orders from "../lib/purchase-orders.ts";

const companyId = "4a570810-0700-44ac-b075-b10446df66aa";

test("PO filters reject malformed URL inputs and pagination preserves active filters", () => {
  for (const page of ["0", "-1", "1.5", "Infinity", "100001", "oops"]) assert.equal(purchaseOrderFilters({ page }).page, 1);
  assert.deepEqual(purchaseOrderFilters({ q: ["ignored"], status: "anything", overdue: "true", page: "2" }), { search: "", status: "", overdue: false, page: 2 });
  const filters = purchaseOrderFilters({ q: " Acme & Co ", status: "confirmed", overdue: "1", page: "2" });
  const url = new URL(purchaseOrdersHref(filters), "https://crm.test");
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: "Acme & Co", status: "confirmed", overdue: "1", page: "2" });
  assert.equal(purchaseOrderFilters({ q: "x".repeat(200) }).search.length, 100);
});

test("company register links retain their tab, filters, sorting and page without changing global URLs", () => {
  const filters = { search: "PO & Co/#1006", status: "confirmed", overdue: true, page: 3, sort: "oldest" as const };
  const url = new URL(purchaseOrdersHref(filters, false, companyId), "https://crm.test");
  assert.equal(url.pathname, `/companies/${companyId}`);
  assert.deepEqual(Object.fromEntries(url.searchParams), { tab: "purchase-orders", q: filters.search, status: "confirmed", overdue: "1", page: "3", sort: "oldest" });
  assert.equal(purchaseOrdersHref({}, false, companyId), `/companies/${companyId}?tab=purchase-orders`);
  assert.equal(purchaseOrdersHref(), "/purchase-orders");
  assert.equal(purchaseOrdersHref({}, true), "/purchase-orders/drafts");
  assert.equal(purchaseOrdersHref({ page: 2 }, true), "/purchase-orders/drafts?page=2");
  assert.equal(new URL(purchaseOrdersHref({}, false, "company/id?other=1#section"), "https://crm.test").pathname, "/companies/company%2Fid%3Fother%3D1%23section");
});

test("company draft links keep draft view and omit its redundant status", () => {
  const url = new URL(purchaseOrdersHref({ search: "Quote 5", status: "draft", page: 2, sort: "oldest" }, true, companyId), "https://crm.test");
  assert.equal(url.pathname, `/companies/${companyId}`);
  assert.deepEqual(Object.fromEntries(url.searchParams), { tab: "purchase-orders", view: "drafts", q: "Quote 5", page: "2", sort: "oldest" });
  assert.equal(purchaseOrdersHref({ status: "draft" }, true), "/purchase-orders/drafts");
});

test("overdue deliveries exclude drafts and closed orders, missing dates, and today", () => {
  for (const status of orders.poStatuses) assert.equal(orderIsOverdue({ status, deliveryDate: "2026-11-05" }, "2026-11-06"), ["confirmed", "in_production", "shipped"].includes(status));
  for (const deliveryDate of ["", "2026-11-06", "2026-11-07"]) assert.equal(orderIsOverdue({ status: "confirmed", deliveryDate }, "2026-11-06"), false);
});

test("PO reference search quotes PostgREST syntax rather than allowing injected filters", () => {
  assert.equal(purchaseOrderSearchFilter('%PO,"x"(1)%', []), 'reference.ilike."%PO,\\"x\\"(1)%"');
  assert.equal(purchaseOrderSearchFilter("%Acme%", ["company-a"]), 'reference.ilike."%Acme%",company_id.in.(company-a)');
});

type Call = { table: string; query: number; method: string; args: unknown[] };
function dataModule(responses: Record<string, unknown>[]) {
  const calls: Call[] = [];
  let queryIndex = 0;
  const client = { from(table: string) {
    const query = queryIndex++;
    const response = responses.shift();
    if (!response) throw new Error(`Unexpected query: ${table}`);
    const builder = new Proxy({}, { get(_target, method: string) {
      if (method === "then") return (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(response));
      return (...args: unknown[]) => { calls.push({ table, query, method, args }); return builder; };
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

test("company PO search applies company scope before pagination and searches only PO number or reference", async () => {
  const { exports, calls } = dataModule([{ data: [], count: 37, error: null }]);
  const result = await exports.listPurchaseOrders({ search: "#1006", status: "confirmed", overdue: true, page: 2, sort: "oldest" }, "2026-11-07", companyId) as { count: number };
  assert.equal(result.count, 37);
  assert.ok(calls.every(call => call.table === "purchase_orders"));
  assert.ok(calls.some(call => call.method === "eq" && call.args[0] === "company_id" && call.args[1] === companyId));
  assert.ok(calls.some(call => call.method === "or" && call.args[0] === 'reference.ilike."%#1006%",number.eq.1006'));
  assert.ok(calls.some(call => call.method === "eq" && call.args[0] === "document->>status" && call.args[1] === "confirmed"));
  assert.ok(calls.some(call => call.method === "lt" && call.args[0] === "document->>deliveryDate" && call.args[1] === "2026-11-07"));
  assert.ok(calls.some(call => call.method === "select" && (call.args[1] as { count: string }).count === "exact"));
  assert.ok(calls.some(call => call.method === "range" && call.args[0] === 25 && call.args[1] === 49));
  assert.ok(calls.findIndex(call => call.method === "eq" && call.args[0] === "company_id") < calls.findIndex(call => call.method === "range"));
  const ordering = calls.filter(call => call.method === "order");
  assert.deepEqual(ordering.map(call => call.args[0]), ["document->>orderDate", "created_at", "id"]);
  assert.equal((ordering[0].args[1] as { ascending: boolean }).ascending, true);
  assert.equal((ordering[1].args[1] as { ascending: boolean }).ascending, true);
});

test("company main and draft registers preserve their separate stages and stable sort", async () => {
  for (const status of ["", "draft"]) {
    const { exports, calls } = dataModule([{ data: [], count: 0, error: null }]);
    await exports.listPurchaseOrders({ search: "PO-26", status, overdue: false, page: 1 }, "2026-11-07", companyId);
    assert.ok(calls.some(call => call.method === "eq" && call.args[0] === "company_id" && call.args[1] === companyId));
    assert.ok(calls.some(call => call.method === (status ? "eq" : "neq") && call.args[0] === "document->>status" && call.args[1] === "draft"));
    assert.ok(calls.some(call => call.method === "or" && call.args[0] === 'reference.ilike."%PO-26%"'));
    assert.ok(calls.every(call => call.table === "purchase_orders"));
    assert.deepEqual(calls.filter(call => call.method === "order").map(call => call.args[0]), status ? ["created_at", "id"] : ["document->>orderDate", "created_at", "id"]);
  }
});

test("invalid company scopes are rejected before accessing purchase order data", async () => {
  const { exports, calls } = dataModule([]);
  for (const invalidId of ["", "company-a", `${companyId},company_id.not.is.null`]) {
    await assert.rejects(() => exports.listPurchaseOrders({ search: "", status: "", overdue: false, page: 1 }, "2026-11-07", invalidId), /Invalid UUID/);
    await assert.rejects(() => exports.purchaseOrderOverview("2026-11-07", invalidId), /Invalid UUID/);
  }
  assert.equal(calls.length, 0);
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

test("company stage and overdue totals scope every exact count to the selected company", async () => {
  const { exports, calls } = dataModule([...orders.poStatuses.map((_, index) => ({ count: index + 2, error: null })), { count: 1, error: null }]);
  const result = await exports.purchaseOrderOverview("2026-11-07", companyId) as { stages: Record<string, number>; overdue: number };
  assert.equal(result.stages.draft, 2);
  assert.equal(result.stages.cancelled, 7);
  assert.equal(result.overdue, 1);
  const queries = [...new Set(calls.map(call => call.query))];
  assert.equal(queries.length, orders.poStatuses.length + 1);
  for (const query of queries) {
    const queryCalls = calls.filter(call => call.query === query);
    assert.ok(queryCalls.every(call => call.table === "purchase_orders"));
    assert.equal(queryCalls.filter(call => call.method === "eq" && call.args[0] === "company_id" && call.args[1] === companyId).length, 1);
    assert.ok(queryCalls.some(call => call.method === "select" && (call.args[1] as { count: string; head: boolean }).count === "exact" && (call.args[1] as { head: boolean }).head));
  }
  assert.equal(calls.filter(call => call.method === "eq" && call.args[0] === "document->>status").length, orders.poStatuses.length);
  const overdueQuery = queries.at(-1);
  assert.ok(calls.some(call => call.query === overdueQuery && call.method === "in" && call.args[0] === "document->>status"));
  assert.ok(calls.some(call => call.query === overdueQuery && call.method === "lt" && call.args[0] === "document->>deliveryDate" && call.args[1] === "2026-11-07"));
});

test("order history is scoped to the selected company and purchase order", async () => {
  const { exports, calls } = dataModule([{ data: [{ id: "event", created_at: "2026-11-06T08:00:00Z", type: "purchase_order_created", data: { summary: "PO #1006 created" } }], error: null }]);
  const activity = await exports.getPurchaseOrderActivity("order-a", "company-a") as { summary: string }[];
  assert.equal(activity[0].summary, "PO #1006 created");
  assert.ok(calls.some(call => call.table === "events" && call.method === "eq" && call.args[0] === "company_id" && call.args[1] === "company-a"));
  assert.ok(calls.some(call => call.method === "contains" && (call.args[1] as { purchaseOrderId: string }).purchaseOrderId === "order-a"));
  assert.ok(calls.some(call => call.method === "limit" && call.args[0] === 30));
});

test("register delivery details use one batch of issued invoices and exclude void or draft invoices", async () => {
  const document = { reference: "PO-1", orderDate: "2026-11-07", deliveryDate: "", currency: "USD", status: "confirmed", shippingAddress: "", shippingRecipient: "", shippingPhone: "", notes: "", items: [{ description: "Product", sku: "P1", quantity: 1, unitPriceMinor: 100 }] };
  const { exports, calls } = dataModule([
    { data: [{ id: "order-a", document, company: { name: "Customer" }, invoices: [{ id: "issued-a", status: "issued" }, { id: "void-a", status: "void" }, { id: "draft-a", status: "draft" }] }], count: 1, error: null },
    { data: [{ invoice_id: "issued-a", status: "delivered", tracking_number: "123", expected_delivery: "2026-11-07", updated_at: "2026-11-07T08:00:00Z" }], error: null },
  ]);
  const result = await exports.listPurchaseOrders({ search: "", status: "", overdue: false, page: 1 }, "2026-11-07") as { orders: { shipments: { status: string }[] }[] };
  assert.equal(result.orders[0].shipments[0].status, "delivered");
  assert.equal(calls.filter(call => call.table === "customer_portal_shipments" && call.method === "in").length, 1);
  assert.equal(JSON.stringify(calls.find(call => call.table === "customer_portal_shipments" && call.method === "in")?.args), JSON.stringify(["invoice_id", ["issued-a"]]));
});

test("main register excludes drafts and sorts by order date with stable creation/id ties", async () => {
  for (const sort of [undefined, "oldest"] as const) {
    const { exports, calls } = dataModule([{ data: [], count: 0, error: null }]);
    await exports.listPurchaseOrders({ search: "", status: "", overdue: false, page: 1, sort }, "2026-11-07");
    assert.ok(calls.some(call => call.method === "neq" && call.args[0] === "document->>status" && call.args[1] === "draft"));
    const ordering = calls.filter(call => call.table === "purchase_orders" && call.method === "order");
    assert.deepEqual(ordering.map(call => call.args[0]), ["document->>orderDate", "created_at", "id"]);
    assert.equal((ordering[0].args[1] as { ascending: boolean }).ascending, sort === "oldest");
    assert.equal((ordering[1].args[1] as { ascending: boolean }).ascending, sort === "oldest");
  }
});

test("draft register stays scoped to drafts and follows creation rather than customer order date", async () => {
  for (const sort of [undefined, "oldest"] as const) {
    const { exports, calls } = dataModule([{ data: [], count: 0, error: null }]);
    await exports.listPurchaseOrders({ search: "", status: "draft", overdue: false, page: 1, sort }, "2026-11-07");
    assert.ok(calls.some(call => call.method === "eq" && call.args[0] === "document->>status" && call.args[1] === "draft"));
    const ordering = calls.filter(call => call.table === "purchase_orders" && call.method === "order");
    assert.deepEqual(ordering.map(call => call.args[0]), ["created_at", "id"]);
    assert.equal((ordering[0].args[1] as { ascending: boolean }).ascending, sort === "oldest");
    assert.equal(calls.filter(call => call.table === "customer_portal_shipments").length, 0);
  }
});
