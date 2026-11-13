import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blankPurchaseOrder } from "../lib/purchase-order-draft.ts";
import { purchaseOrderActions, orderDisplayDate } from "../lib/purchase-order-summary.ts";
import * as purchaseOrders from "../lib/purchase-orders.ts";
import * as draft from "../lib/purchase-order-draft.ts";
import * as summary from "../lib/purchase-order-summary.ts";
import * as invoices from "../lib/invoices.ts";
import * as orderBilling from "../lib/purchase-order-billing.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const order: purchaseOrders.PurchaseOrder = {
  id: "order-a", company_id: "company-a", number: 1006, version: 1, created_at: "2026-11-06T07:00:00Z", total_minor: 1418,
  document: { ...blankPurchaseOrder("2026-11-06"), reference: "#1006", items: [{ description: "ABS Black", sku: "ABS-BLACK", quantity: 2, unitPriceMinor: 709 }] }, invoices: [],
};
const customer = { companyName: "Example Company", contactName: "Example Person", contactRole: "Buyer", contactEmail: "buyer@example.test", billingEmail: "buyer@example.test", billingAddress: "100 Example Street", phone: "", taxId: "" };

test("saved-order actions retain invoice reservations and payment gates", () => {
  assert.equal(purchaseOrderActions(order).canInvoice, false);
  assert.ok(!purchaseOrderActions(order).statuses.includes("shipped"));
  assert.ok(purchaseOrderActions(order).statuses.includes("confirmed"));
  const confirmed = { ...order, document: { ...order.document, status: "confirmed" as const } };
  assert.equal(purchaseOrderActions(confirmed).canInvoice, true);
  const reserved = { ...confirmed, invoices: [{ id: "invoice", number: 1, status: "draft" as const, total_minor: 1418, paid_minor: 0, document: { currency: "USD", items: [{ purchaseOrderLineId: "line-1", quantity: 2 }] } }] };
  assert.equal(purchaseOrderActions(reserved).canInvoice, false);
  assert.ok(!purchaseOrderActions(reserved).statuses.includes("draft"));
  assert.ok(!purchaseOrderActions(reserved).statuses.includes("cancelled"));
  const paid = { ...reserved, invoices: reserved.invoices.map(invoice => ({ ...invoice, status: "issued" as const, paid_minor: 1418 })) };
  assert.ok(purchaseOrderActions(paid).statuses.includes("shipped"));
  assert.ok(purchaseOrderActions(paid).statuses.includes("completed"));
});

test("order dates use the workspace timezone across midnight", () => {
  assert.equal(orderDisplayDate("2026-11-05T17:30:00Z"), "Nov 6, 2026");
  assert.equal(orderDisplayDate("2026-11-06"), "Nov 6, 2026");
});

const require = createRequire(import.meta.url);
function summaryComponent() {
  const exports: { PurchaseOrderSummary?: (props: Record<string, unknown>) => React.ReactNode } = {};
  const deps: Record<string, unknown> = {
    "next/link": { default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => createElement("a", { ...props, href }, children) },
    "next/image": { default: (props: Record<string, unknown>) => { const imageProps = { ...props }; delete imageProps.unoptimized; return createElement("img", imageProps); } },
    "@/components/purchase-order-status": { PurchaseOrderStatus: ({ status }: { status: (typeof purchaseOrders.poStatuses)[number] }) => createElement("span", {}, purchaseOrders.poStatusLabels[status]) },
    "@/lib/purchase-orders": purchaseOrders, "@/lib/purchase-order-draft": draft, "@/lib/purchase-order-summary": summary, "@/lib/invoices": invoices, "@/lib/purchase-order-billing": orderBilling,
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/purchase-order-summary.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => deps[name] ?? require(name))(name), Set });
  return exports.PurchaseOrderSummary!;
}

test("saved orders display products, totals, customer and timeline without an editing form", () => {
  const html = renderToStaticMarkup(createElement(summaryComponent(), { order, customer, companyName: customer.companyName, country: "United States", activity: [] }));
  for (const text of ["#1006", "ABS Black", "$14.18", "Example Company", "100 Example Street", "Timeline", "Order created"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<(?:input|textarea|select|fieldset)\b/);
  assert.doesNotMatch(html, /Linked invoices &amp; payment|Refresh from saved profile|Company, contact &amp; billing|Invoice balance/);
});

test("invoice balances appear only when issued invoices exist", () => {
  const issued = { ...order, invoices: [{ id: "invoice", number: 1, status: "issued" as const, total_minor: 1418, paid_minor: 500, document: { currency: "USD", items: [{ purchaseOrderLineId: "line-1", quantity: 2 }] } }] };
  const html = renderToStaticMarkup(createElement(summaryComponent(), { order: issued, customer, companyName: customer.companyName, country: "", activity: [] }));
  assert.match(html, /Invoice balance/);
  assert.match(html, /\$9\.18/);
  assert.match(html, /INV-000001/);
});
