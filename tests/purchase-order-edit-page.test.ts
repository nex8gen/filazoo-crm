import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { blankPurchaseOrder } from "../lib/purchase-order-draft.ts";
import type { PurchaseOrder } from "../lib/purchase-orders.ts";
import { commerceDefaults } from "../lib/company-commerce.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const require = createRequire(import.meta.url);
const id = "083bb9b2-a99d-461e-aba2-c3d571598174";
function editPage(role = "admin") {
  const reads: string[] = [];
  const order: PurchaseOrder & { companyName: string } = { id, company_id: "company-a", companyName: "Customer", number: 1006, version: 7, created_at: "2026-11-06T08:00:00Z", total_minor: 100,
    document: { ...blankPurchaseOrder("2026-11-06"), reference: "#1006", items: [{ description: "Saved product", sku: "PLA", productSku: "PLA", quantity: 1, unitPriceMinor: 100 }] } };
  const Composer = () => null;
  const deps: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Access denied"); return { role }; } },
    "next/navigation": { notFound: () => { throw new Error("Not found"); } },
    "@/lib/data/purchase-orders": { getPurchaseOrder: async (value: string) => { reads.push(value); return order; } },
    "@/app/purchase-order-actions": {
      getPurchaseOrderProfile: async () => ({ customer: { companyName: "Current customer", contactName: "", contactRole: "", contactEmail: "", billingEmail: "", billingAddress: "", phone: "", taxId: "" }, commerce: commerceDefaults(), contacts: [] }),
      loadPurchaseOrderProducts: async (skus: string[]) => { assert.deepEqual(Array.from(skus), ["PLA"]); return { products: [], count: 0 }; },
    },
    "@/components/purchase-order-composer": { PurchaseOrderComposer: Composer },
  };
  const exports: { default?: (input: { params: Promise<{ id: string }> }) => Promise<{ type: unknown; props: { initialOrder: PurchaseOrder; initialCompanyId: string } }> } = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/purchase-orders/[id]/edit/page.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => deps[name] ?? require(name))(name), Date, Set });
  return { page: exports.default!, order, Composer, reads };
}

test("Edit order opens the same page composer with the saved ID, revision and products", async () => {
  const { page, order, Composer } = editPage();
  const result = await page({ params: Promise.resolve({ id }) });
  assert.equal(result.type, Composer);
  assert.equal(result.props.initialOrder, order);
  assert.equal(result.props.initialOrder.version, 7);
  assert.equal(result.props.initialCompanyId, "company-a");
});

test("read-only viewers cannot load the edit page or its data", async () => {
  const { page, reads } = editPage("viewer");
  await assert.rejects(() => page({ params: Promise.resolve({ id }) }), /Access denied/);
  assert.deepEqual(reads, []);
});

test("malformed edit URLs fail before querying order data", async () => {
  const { page, reads } = editPage();
  await assert.rejects(() => page({ params: Promise.resolve({ id: "invalid" }) }), /Not found/);
  assert.deepEqual(reads, []);
});
