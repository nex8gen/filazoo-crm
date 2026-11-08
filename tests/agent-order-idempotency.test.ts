import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as orders from "../lib/purchase-orders.ts";
import * as billing from "../lib/purchase-order-billing.ts";
import { z } from "zod";

const require = createRequire(import.meta.url);
const companyId = "a1111111-1111-4111-8111-111111111111";
const userId = "b2222222-2222-4222-8222-222222222222";
const actionId = "c3333333-3333-4333-8333-333333333333";
function fixture() {
  const saved = new Map<string, Record<string, unknown>>();
  let inserts = 0, loseResponse = false;
  const db = { from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let insertion: Record<string, unknown> | undefined;
    const run = () => {
      if (insertion) {
        inserts++;
        if (saved.has(String(insertion.id))) return { data: null, error: { code: "23505" } };
        const document = insertion.document as orders.PurchaseOrderDocument;
        const record = { ...insertion, document: { ...document, reference: document.reference || "#1001" } };
        saved.set(String(insertion.id), record);
        if (loseResponse) { loseResponse = false; return { data: null, error: { code: "FETCH_ERROR" } }; }
        return { data: record, error: null };
      }
      if (table === "companies") return { data: { id: companyId }, error: null };
      const record = [...saved.values()].find(row => filters.every(([key, value]) => row[key] === value));
      return { data: record ?? null, error: null };
    };
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, insert(row: Record<string, unknown>) { insertion = row; return query; }, maybeSingle: async () => run(), single: async () => run() };
    return query;
  } };
  const dependencies: Record<string, unknown> = { zod: { z }, "@/lib/purchase-orders": orders, "@/lib/purchase-order-billing": billing, "next/cache": { revalidatePath() {} },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: userId, role: "admin" }) }, "@/lib/supabase/admin": { createSupabaseAdmin: () => db } };
  const exports = {} as typeof import("../app/purchase-order-actions.ts");
  const code = ts.transpileModule(readFileSync(new URL("../app/purchase-order-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? (name.startsWith("@/") ? {} : require(name)), Error, Date, JSON });
  const document = orders.purchaseOrderCreateSchema.parse({ reference: "", orderDate: "2026-11-07", deliveryDate: "", currency: "USD", status: "draft", shippingAddress: "", shippingRecipient: "", shippingPhone: "", notes: "",
    customer: { companyName: "Synthetic", contactName: "Buyer", contactRole: "", contactEmail: "buyer@example.com", billingEmail: "buyer@example.com", billingAddress: "", taxId: "", phone: "" }, items: [{ description: "Agreed custom part", sku: "CUSTOM", quantity: 100, unitPriceMinor: 500 }] });
  return { api: exports, document, saved, inserts: () => inserts, loseNextResponse() { loseResponse = true; } };
}

test("the real order save service reuses the approved ID after a lost response and accepts its generated number", async () => {
  const f = fixture();
  f.loseNextResponse();
  const interrupted = await f.api.savePurchaseOrder(companyId, null, 0, f.document, actionId);
  assert.ok(interrupted.error);
  const recovered = await f.api.savePurchaseOrder(companyId, null, 0, f.document, actionId);
  assert.equal(recovered.orderId, actionId);
  assert.equal(f.saved.size, 1); assert.equal(f.inserts(), 1);
});

test("a reused action ID cannot change an existing order or another creator's order", async () => {
  const f = fixture();
  await f.api.savePurchaseOrder(companyId, null, 0, f.document, actionId);
  await assert.rejects(() => f.api.savePurchaseOrder(companyId, null, 0, { ...f.document, items: [{ ...f.document.items[0], quantity: 200 }] }, actionId), /changed/);
  f.saved.get(actionId)!.created_by = "another-user";
  const result = await f.api.savePurchaseOrder(companyId, null, 0, f.document, actionId);
  assert.ok(result.error); assert.equal(f.saved.size, 1);
});
