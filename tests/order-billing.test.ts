import assert from "node:assert/strict";
import test from "node:test";
import { blankPurchaseOrder } from "../lib/purchase-order-draft.ts";
import { orderBillingFromInvoice, orderInvoiceDraft, purchaseOrderAmounts } from "../lib/purchase-order-billing.ts";
import { blankInvoiceDocument, invoiceLabel } from "../lib/invoices.ts";
import { invoicePdfFilename } from "../lib/invoice-pdf-meta.ts";
import { orderInvoiceHref } from "../lib/order-invoice-links.ts";
import { purchaseOrderCreateSchema } from "../lib/purchase-orders.ts";

const billing = { ...orderBillingFromInvoice(blankInvoiceDocument("2026-11-06")), discountMinor: 500, taxBps: 1000 };
const order = { ...blankPurchaseOrder("2026-11-06"), billing, items: [{ description: "Product", sku: "PLA", quantity: 2, unitPriceMinor: 1000 }, { description: "Shipping", sku: "SHIPPING", quantity: 1, unitPriceMinor: 500 }] };

test("PO totals allocate the discount before tax and keep shipping untaxed", () => {
  const amounts = purchaseOrderAmounts(order);
  assert.equal(amounts.tax, 160);
  assert.equal(amounts.total, 2160);
  assert.deepEqual(orderInvoiceDraft(order).items.map(item => item.taxBps), [1000, 0]);
});

test("the one PO form validates billing dates, discounts, and payment currencies", () => {
  assert.equal(purchaseOrderCreateSchema.safeParse(order).success, true);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...order, billing: { ...billing, discountMinor: 2501 } }).success, false);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...order, billing: { ...billing, dueDate: "2026-11-05" } }).success, false);
  const method = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "paypal", label: "PayPal", currency: "USD", details: "", paymentUrl: "https://example.test/pay" };
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...order, billing: { ...billing, paymentMethods: [method] } }).success, true);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...order, currency: "EUR", billing: { ...billing, paymentMethods: [method] } }).success, false);
});

test("retired bank, manual instructions and seller overrides cannot be submitted or retained in PO billing", () => {
  for (const key of ["bankAccountId", "bankAccount", "paymentInstructions", "sellerName", "sellerAddress", "sellerTaxId"]) {
    assert.equal(purchaseOrderCreateSchema.safeParse({ ...order, billing: { ...billing, [key]: "retired" } }).success, false, key);
  }
  const fields = orderBillingFromInvoice({ ...blankInvoiceDocument("2026-11-06"), sellerName: "Override", paymentInstructions: "Manual instructions", bankAccountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.deepEqual(Object.keys(fields).sort(), ["discountMinor", "dueDate", "issueDate", "paymentMethods", "taxBps"]);
});

test("the order, invoice heading, PDF filename and destination share the order number", () => {
  const invoice = { id: "invoice-id", number: 1006, order_managed: true, status: "draft" as const, document: { purchaseOrderId: "order-id" } };
  assert.equal(invoiceLabel(invoice), "#1006");
  assert.equal(invoicePdfFilename(invoice), "#1006-DRAFT.pdf");
  assert.equal(orderInvoiceHref(invoice), "/purchase-orders/order-id");
});
