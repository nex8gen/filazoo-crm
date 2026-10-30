import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as search from "../lib/workspace-search.ts";
import * as personalization from "../lib/product-personalization.ts";

type Call = { table: string; method: string; args: unknown[] };
function load(options: { role?: string; denied?: boolean; failed?: string } = {}) {
  let authorized = false;
  const calls: Call[] = [];
  const db = { from(table: string) {
    assert.ok(authorized, "Authenticate before constructing privileged queries");
    let fields = "";
    const query: Record<string, unknown> = {};
    for (const method of ["select", "or", "eq", "order", "limit", "not", "in", "abortSignal"]) query[method] = (...args: unknown[]) => { calls.push({ table, method, args }); if (method === "select") fields = String(args[0]); return query; };
    query.then = async (resolve: (value: unknown) => void) => {
      if (table === options.failed) return resolve({ data: null, error: { message: "private source details" } });
      let data: unknown[] = [];
      if (table === "companies") data = [{ id: "company", name: "Acme", domain: "acme.test" }];
      if (table === "invoices") data = [{ id: "invoice", number: 42, customer_name: "Acme", reference: "Order", companies: null }];
      if (table === "products") data = [{ sku: "PLA", name: "Original Acme PLA", active: true }, { sku: "PETG", name: "Acme hidden", active: true }];
      if (table === "user_product_overrides") data = fields.includes("products!") ? [{ product_sku: "PLA", data: { name: "Acme personal PLA" }, products: { sku: "PLA", name: "Original PLA", active: true } }]
        : [{ product_sku: "PLA", data: { name: "Acme personal PLA" }, updated_at: "now" }, { product_sku: "PETG", data: { active: false }, updated_at: "now" }];
      return resolve({ data, error: null });
    };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "../workspace-search.ts": search, "../product-personalization.ts": personalization,
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.denied) throw new Error("Denied"); authorized = true; return { id: "viewer", role: options.role ?? "operator" }; } },
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
  };
  const exports = {} as { searchWorkspace: (query: string) => Promise<search.WorkspaceSearchResponse> };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/workspace-search.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? {}, AbortSignal });
  return { api: exports, calls };
}
test("workspace search denies inactive membership before creating any queries", async () => {
  const { api, calls } = load({ denied: true }); await assert.rejects(api.searchWorkspace("Acme"), /Denied/); assert.equal(calls.length, 0);
});
test("workspace search rejects broad wildcard input before database access", async () => {
  const { api, calls } = load(); await assert.rejects(api.searchWorkspace("**"), /2-120/); assert.equal(calls.length, 0);
});
test("workspace search scopes every BD customer result and personal source", async () => {
  const { api, calls } = load({ role: "bd_manager" }); const result = await api.searchWorkspace("Acme");
  for (const [table, column] of [["companies", "pipeline.owner_id"], ["contacts", "companies.pipeline.owner_id"], ["purchase_orders", "companies.pipeline.owner_id"], ["invoices", "companies.pipeline.owner_id"], ["invoices", "created_by"], ["customer_portal_shipments", "invoices.companies.pipeline.owner_id"], ["crm_tasks", "assigned_to"], ["user_product_overrides", "user_id"]]) {
    assert.ok(calls.some(call => call.table === table && call.method === "eq" && call.args[0] === column && call.args[1] === "viewer"), `${table}.${column}`);
  }
  assert.equal(result.results.filter(item => item.kind === "invoice").length, 1);
  assert.ok(calls.filter(call => call.method === "select" && call.table === "companies").every(call => String(call.args[0]).includes("pipeline!inner")));
});
test("workspace search applies only the viewer's product names and active settings", async () => {
  const result = await load().api.searchWorkspace("Acme"); const products = result.results.filter(item => item.kind === "product");
  assert.equal(products.length, 1); assert.equal(products[0].title, "Acme personal PLA"); assert.equal(products[0].id, "PLA");
});
test("workspace search reports partial source failures while preserving successful results", async () => {
  const result = await load({ failed: "invoices" }).api.searchWorkspace("Acme");
  assert.equal(result.unavailable.join(), "invoice"); assert.ok(result.results.some(item => item.kind === "company"));
  assert.ok(!JSON.stringify(result).includes("private source details"));
});
test("workspace search does not silently fall back to base product details when private overrides fail", async () => {
  const result = await load({ failed: "user_product_overrides" }).api.searchWorkspace("Acme");
  assert.ok(result.unavailable.includes("product")); assert.ok(!result.results.some(item => item.kind === "product"));
});
