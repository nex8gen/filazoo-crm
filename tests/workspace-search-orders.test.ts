import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const companyId = "a1a23af0-e1da-43af-a424-6fd559ed0c2a";
const orderId = "bb223af0-e1da-43af-a424-6fd559ed0c2a";
function load() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let authorized = false;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "range"]) builder[method] = (...args: unknown[]) => { assert.ok(authorized); calls.push({ method, args }); return builder; };
  builder.then = async (resolve: (value: unknown) => void) => resolve({ data: [], count: 0, error: null });
  const deps: Record<string, unknown> = {
    zod: { z },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { assert.ok(roles.includes("viewer")); authorized = true; return { id: "viewer", role: "viewer" }; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => builder }) },
  };
  const exports = {} as { listCompanyPurchaseOrders: (company: string, page?: number, order?: string) => Promise<{ orders: unknown[] }> };
  const code = ts.transpileModule(readFileSync(new URL("../app/purchase-order-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? {} });
  return { api: exports, calls };
}
test("search order links load the selected order under the selected company before pagination", async () => {
  const { api, calls } = load(); await api.listCompanyPurchaseOrders(companyId, 0, orderId);
  const filters = calls.filter(call => call.method === "eq");
  assert.deepEqual(filters.map(call => call.args), [["company_id", companyId], ["id", orderId]]);
  assert.ok(calls.findIndex(call => call.method === "eq" && call.args[0] === "id") < calls.findIndex(call => call.method === "range"));
});
test("invalid order identifiers are rejected before querying; ordinary order browsing stays unfiltered", async () => {
  const { api, calls } = load(); await assert.rejects(api.listCompanyPurchaseOrders(companyId, 0, "invalid")); assert.equal(calls.length, 0);
  await api.listCompanyPurchaseOrders(companyId);
  assert.ok(!calls.some(call => call.method === "eq" && call.args[0] === "id"));
});
