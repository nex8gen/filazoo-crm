import assert from "node:assert/strict";
import test from "node:test";
import { blankPurchaseOrder } from "../lib/purchase-order-draft.ts";
import { purchaseOrderRegisterRow, registerDate, registerOrderDate } from "../lib/purchase-order-register.ts";
import type { OrderInvoice, PurchaseOrder } from "../lib/purchase-orders.ts";

const order: PurchaseOrder & { companyName: string; country: string } = {
  id: "order-a", company_id: "company-a", companyName: "Example Customer", country: "France", number: 1006,
  version: 1, created_at: "2026-11-06T17:30:00Z", total_minor: 200,
  document: { ...blankPurchaseOrder("2026-11-07"), status: "confirmed", reference: "CUSTOMER-PO", items: [{ description: "Product", sku: "P1", quantity: 2, unitPriceMinor: 100 }] },
};
const invoice = (id: string, quantity: number, paid = 100): OrderInvoice => ({
  id, number: 1006, status: "issued", total_minor: quantity * 100, paid_minor: paid,
  document: { currency: "USD", items: [{ purchaseOrderLineId: "line-1", quantity }] },
});

test("paid partial invoices do not label an under-invoiced purchase order as paid", () => {
  assert.equal(purchaseOrderRegisterRow({ ...order, invoices: [invoice("a", 1)] }).payment.label, "Partially paid");
  assert.equal(purchaseOrderRegisterRow({ ...order, invoices: [invoice("a", 2, 200)] }).payment.label, "Paid");
  assert.equal(purchaseOrderRegisterRow(order).payment.label, "Not invoiced");
  assert.equal(purchaseOrderRegisterRow({ ...order, invoices: [invoice("a", 2, 0)] }).payment.label, "Unpaid");
  assert.equal(purchaseOrderRegisterRow({ ...order, invoices: [invoice("a", 2, 100)] }).invoiceBalance, 100);
  assert.equal(purchaseOrderRegisterRow({ ...order, invoices: [invoice("a", 2, 100)] }).payment.label, "Partially paid");
});

test("delivery remains incomplete when one issued invoice has no delivered shipment", () => {
  const shipments = [{ invoice_id: "a", status: "delivered" }];
  const split = { ...order, invoices: [invoice("a", 1), invoice("b", 1)] };
  assert.notEqual(purchaseOrderRegisterRow({ ...order, invoices: [invoice("a", 1)], shipments }).delivery?.label, "Delivered");
  assert.notEqual(purchaseOrderRegisterRow({ ...split, shipments }).delivery?.label, "Delivered");
  const completedShipments = [...shipments, { invoice_id: "b", status: "delivered" }];
  assert.equal(purchaseOrderRegisterRow({ ...split, shipments: completedShipments }).delivery?.label, "Delivered");
  assert.equal(purchaseOrderRegisterRow({ ...split, shipments: [{ invoice_id: "a", status: "delivered" }, { invoice_id: "b", status: "exception" }] }).delivery?.label, "Exception");
});

test("item quantities omit custom shipping charges while retaining catalog products whose SKU is SHIPPING", () => {
  const document = { ...order.document, items: [...order.document.items,
    { description: "Delivery", sku: "SHIPPING", quantity: 1, unitPriceMinor: 500 },
    { description: "Catalog product", sku: "SHIPPING", productSku: "catalog-shipping", quantity: 4, unitPriceMinor: 100 },
  ] };
  assert.equal(purchaseOrderRegisterRow({ ...order, document }).itemCount, 6);
});

test("register dates use China-local calendar boundaries and unambiguous B2B calendar dates", () => {
  assert.equal(registerDate("2026-11-06T17:30:00Z", "2026-11-07"), "Today at 1:30 am");
  assert.equal(registerDate("2026-11-06T15:30:00Z", "2026-11-07"), "Yesterday at 11:30 pm");
  assert.equal(registerOrderDate("2026-11-08"), "Nov 8, 2026");
  assert.equal(registerDate("invalid", "2026-11-07"), "—");
});

test("register exposes production stages and flags only overdue active orders", () => {
  for (const [status, label] of [["confirmed", "Confirmed"], ["in_production", "In production"], ["shipped", "Shipped"], ["completed", "Completed"], ["cancelled", "Cancelled"]] as const) {
    const document = { ...order.document, status, deliveryDate: "2026-11-06" };
    const row = purchaseOrderRegisterRow({ ...order, document }, "2026-11-07");
    assert.equal(row.orderStatus.label, label);
    assert.equal(row.overdue, ["confirmed", "in_production", "shipped"].includes(status));
    assert.equal(row.orderDate, document.orderDate);
    assert.equal(row.reference, "CUSTOMER-PO");
  }
});
