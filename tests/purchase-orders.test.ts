import assert from "node:assert/strict";
import test from "node:test";
import {
  purchaseOrderSchema,
  purchaseOrderTotal,
  orderBillingSummary,
  type PurchaseOrder,
} from "../lib/purchase-orders.ts";
import { commerceDefaults, commerceSchema } from "../lib/company-commerce.ts";

test("default payment policy is full prepayment and exceptions require agreed terms", () => {
  assert.equal(commerceDefaults().termsDays, 0);
  assert.equal(
    purchaseOrderSchema.parse(order).paymentPolicy,
    "full_before_shipment",
  );
  assert.equal(
    purchaseOrderSchema.safeParse({
      ...order,
      paymentPolicy: "custom",
      preShipmentPercent: 30,
    }).success,
    false,
  );
  assert.equal(
    purchaseOrderSchema.parse({
      ...order,
      paymentPolicy: "custom",
      preShipmentPercent: 30,
      paymentTerms: "Balance within 15 days",
    }).preShipmentPercent,
    30,
  );
});

test("draft reservations, partial invoicing, payments and voids stay separate", () => {
  const po: PurchaseOrder = {
    id: "po",
    company_id: "company",
    version: 1,
    created_at: "",
    total_minor: 10000,
    document: purchaseOrderSchema.parse({
      ...order,
      items: [
        {
          description: "Filament",
          sku: "PLA",
          quantity: 10,
          unitPriceMinor: 1000,
        },
      ],
    }),
    invoices: [],
  };
  const invoice = {
    id: "inv",
    number: 1,
    status: "draft" as const,
    total_minor: 10000,
    paid_minor: 0,
    document: {
      currency: "USD",
      items: [{ purchaseOrderLineId: "line-1", quantity: 10 }],
    },
  };
  po.invoices = [invoice];
  assert.equal(orderBillingSummary(po).quantities.get("line-1"), 10);
  assert.equal(orderBillingSummary(po).total, 0);
  assert.equal(orderBillingSummary(po).canShip, false);
  po.invoices = [{ ...invoice, status: "issued", paid_minor: 3000 }];
  assert.equal(orderBillingSummary(po).fullyInvoiced, true);
  assert.equal(orderBillingSummary(po).outstanding, 7000);
  assert.equal(orderBillingSummary(po).canShip, false);
  po.document = {
    ...po.document,
    paymentPolicy: "custom",
    preShipmentPercent: 30,
    paymentTerms: "30% before shipping; balance later",
  };
  assert.equal(orderBillingSummary(po).canShip, true);
  po.invoices = [{ ...invoice, status: "void" }];
  assert.equal(orderBillingSummary(po).quantities.size, 0);
  assert.equal(orderBillingSummary(po).fullyInvoiced, false);
  assert.equal(orderBillingSummary(po).canShip, false);
});

const order = {
  reference: "PO-123",
  orderDate: "2026-10-26",
  deliveryDate: "2026-11-01",
  currency: "USD",
  status: "draft",
  shippingAddress: "Shanghai",
  shippingRecipient: "Rick",
  shippingPhone: "+86 123",
  notes: "",
  items: [
    { description: "Filament", sku: "PLA", quantity: 3, unitPriceMinor: 1299 },
  ],
};
test("PO totals use integer minor units across multiple items", () => {
  assert.equal(
    purchaseOrderTotal([
      ...order.items,
      { description: "Sample", sku: "", quantity: 2, unitPriceMinor: 10 },
    ]),
    3917,
  );
  assert.equal(purchaseOrderSchema.parse(order).reference, "PO-123");
});
test("rejects invalid dates, empty items, fractional quantities, and excessive totals", () => {
  for (const patch of [
    { deliveryDate: "2026-10-01" },
    { orderDate: "2026-02-30" },
    { items: [] },
    { status: "paid" },
    { currency: "BAD" },
    { items: [{ ...order.items[0], quantity: 1.5 }] },
    { items: [{ ...order.items[0], unitPriceMinor: -1 }] },
    {
      items: [
        { ...order.items[0], quantity: 1000000, unitPriceMinor: 100000000 },
      ],
    },
  ]) {
    assert.equal(
      purchaseOrderSchema.safeParse({ ...order, ...patch }).success,
      false,
    );
  }
});
test("delivery can be unscheduled and shipping snapshot stays independent of profile", () => {
  const profile = commerceDefaults({ shippingAddress: "Original address" });
  const saved = purchaseOrderSchema.parse({
    ...order,
    deliveryDate: "",
    shippingAddress: profile.shippingAddress,
  });
  profile.shippingAddress = "New address";
  assert.equal(saved.shippingAddress, "Original address");
});
test("commerce defaults support existing billing profiles and validate terms", () => {
  const profile = commerceDefaults({
    address: "Billing address",
    taxId: "VAT-1",
    email: "billing@example.com",
    currency: "EUR",
    termsDays: 60,
  });
  assert.equal(commerceSchema.parse(profile).shippingAddress, "");
  assert.equal(
    commerceSchema.safeParse({ ...profile, termsDays: -1 }).success,
    false,
  );
  assert.equal(
    commerceSchema.safeParse({ ...profile, email: "invalid" }).success,
    false,
  );
});
