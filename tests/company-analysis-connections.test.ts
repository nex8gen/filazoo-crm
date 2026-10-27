import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { purchaseOrderSchema } from "../lib/purchase-orders.ts";
import * as analysis from "../lib/company-analysis.ts";

const require = createRequire(import.meta.url);
const companyId = "4913b683-bcec-4079-b424-6fd559ed0c2a";
const requestId = "b02b78ed-3f6e-459a-a461-802f6d231af8";
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name in deps ? deps[name] : require(name), Date, Intl, console });
  return exports;
}
function query(result: unknown, observed: [string, ...unknown[]][] = []) {
  const chain: Record<string, unknown> = { then: (resolve: (result: unknown) => void) => Promise.resolve(result).then(resolve) };
  for (const method of ["select", "eq", "like", "order", "range", "in", "single", "upsert"]) chain[method] = (...args: unknown[]) => { observed.push([method, ...args]); return chain; };
  return chain;
}
const document = purchaseOrderSchema.parse({ reference: "QA-PO", orderDate: "2026-01-01", deliveryDate: "", currency: "USD", status: "completed", shippingAddress: "", shippingRecipient: "", shippingPhone: "", notes: "", items: [{ description: "PLA Basic", sku: "BLACK", productSku: "PLA", variantId: "black", quantity: 10, unitPriceMinor: 800 }] });

test("analysis loads every page within the company scope and strips customer snapshots", async () => {
  let pages = 0;
  const calls: [string, ...unknown[]][] = [];
  const db = { from(table: string) {
    calls.push(["from", table]);
    if (table === "purchase_orders") return query({ data: Array.from({ length: pages++ === 0 ? 500 : 1 }, (_, i) => ({ id: `order-${pages}-${i}`, document })), error: null }, calls);
    return query({ data: [], error: null }, calls);
  } };
  const loadedModule = load("../lib/data/company-analysis.ts", { "server-only": {}, "../auth": { requireWorkspaceMember: async (roles: string[]) => assert.ok(roles.includes("viewer")) }, "../supabase/admin": { createSupabaseAdmin: () => db }, "../purchase-orders": { purchaseOrderSchema } });
  const result = await loadedModule.getCompanyAnalysis(companyId) as analysis.CompanyAnalysisData;
  assert.equal(result.orders.length, 501);
  assert.ok(calls.some(call => call[0] === "range" && call[1] === 500 && call[2] === 999));
  assert.equal(calls.filter(call => call[0] === "eq" && call[1] === "company_id" && call[2] === companyId).length, 3);
  assert.ok(!("customer" in result.orders[0]));
});

test("analysis rejects unauthenticated reads before reaching the database and does not turn failed reads into zero totals", async () => {
  let reads = 0;
  const deps = { "server-only": {}, "../auth": { requireWorkspaceMember: async () => { throw new Error("Unauthorized"); } }, "../supabase/admin": { createSupabaseAdmin: () => { reads++; return { from: () => query({ data: null, error: { message: "offline" } }) }; } }, "../purchase-orders": { purchaseOrderSchema } };
  await assert.rejects(load("../lib/data/company-analysis.ts", deps).getCompanyAnalysis(companyId), /Unauthorized/);
  assert.equal(reads, 0);
  deps["../auth"].requireWorkspaceMember = async () => {};
  await assert.rejects(load("../lib/data/company-analysis.ts", deps).getCompanyAnalysis(companyId), /could not be loaded/);
  assert.equal(reads, 1);
});

const sample: analysis.CompanyAnalysisData = { orders: [{ id: "po", reference: document.reference, orderDate: document.orderDate, deliveryDate: "", currency: "USD", status: "completed", items: document.items }], products: [], tasks: [], asOf: "2026-10-27T02:00:00Z" };
const input = { companyId, requestId, productKey: analysis.analysisProductKey(document.items[0]), currency: "USD", dueAt: "2099-01-01T12:00:00Z" };
function actions(role: string, data = sample) {
  const calls: [string, ...unknown[]][] = [];
  let taskWrites = 0;
  const deps = {
    "@/lib/auth": { requireWorkspaceMember: async (allowed: string[]) => { if (!allowed.includes(role)) throw new Error("Forbidden"); return { id: "current-user", role }; } },
    "@/lib/data/company-analysis": { getCompanyAnalysis: async () => data },
    "@/lib/company-analysis": analysis,
    "next/cache": { revalidatePath: (path: string) => calls.push(["revalidate", path]) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from(table: string) {
      if (table === "companies") return query({ data: { id: companyId, pipeline: [{ owner_id: "owner" }] }, error: null }, calls);
      const chain = query({ data: { id: requestId, notes: analysis.analysisTaskMarker(input.productKey), due_at: input.dueAt }, error: null }, calls);
      const upsert = chain.upsert as (...args: unknown[]) => unknown;
      chain.upsert = (...args: unknown[]) => { taskWrites++; return upsert(...args); };
      return chain;
    } }) },
  };
  return { module: load("../app/company-analysis-actions.ts", deps), calls, writes: () => taskWrites };
}

test("viewers cannot create follow-ups, and forged products or past dates cannot create tasks", async () => {
  const viewer = actions("viewer");
  await assert.rejects(viewer.module.createAnalysisFollowup(input), /Forbidden/);
  assert.equal(viewer.writes(), 0);
  const admin = actions("admin");
  const forged = await admin.module.createAnalysisFollowup({ ...input, productKey: "forged" }) as { error: string };
  assert.match(forged.error, /history has changed/);
  const past = await admin.module.createAnalysisFollowup({ ...input, dueAt: "2000-01-01T00:00:00Z" }) as { error: string };
  assert.match(past.error, /future/);
  assert.equal(admin.writes(), 0);
});

test("product follow-up saves to the account owner, uses a retry-safe id, and verifies its saved company scope", async () => {
  const admin = actions("admin");
  const result = await admin.module.createAnalysisFollowup(input) as { task: { id: string } };
  assert.equal(result.task.id, requestId);
  assert.equal(admin.writes(), 1);
  const write = admin.calls.find(call => call[0] === "upsert")!;
  const task = write[1] as { id: string; assigned_to: string; company_id: string; notes: string };
  assert.equal(task.assigned_to, "owner");
  assert.equal(task.company_id, companyId);
  assert.equal(task.id, requestId);
  assert.equal(task.notes, analysis.analysisTaskMarker(input.productKey));
  assert.ok(admin.calls.some(call => call[0] === "eq" && call[1] === "company_id" && call[2] === companyId));
});

test("existing open product follow-ups are reused without creating duplicate tasks", async () => {
  const task = { id: requestId, notes: analysis.analysisTaskMarker(input.productKey), due_at: input.dueAt };
  const admin = actions("admin", { ...sample, tasks: [task] });
  const result = await admin.module.createAnalysisFollowup(input) as { task: { id: string } };
  assert.equal(result.task.id, requestId);
  assert.equal(admin.writes(), 0);
});
