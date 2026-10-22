import test from "node:test";
import assert from "node:assert/strict";
import {
  invoiceDocumentSchema,
  invoiceTotals,
  invoiceStatus,
  paymentSchema,
  type Invoice,
  type InvoiceDocument,
} from "../lib/invoices.ts";

const document: InvoiceDocument = {
  sellerName: "Filazoo",
  sellerAddress: "",
  sellerTaxId: "",
  customerName: "Customer",
  customerEmail: "",
  customerAddress: "",
  customerTaxId: "",
  currency: "USD",
  issueDate: "2026-10-22",
  dueDate: "2026-11-21",
  reference: "",
  notes: "",
  paymentInstructions: "",
  discountMinor: 1000,
  shippingMinor: 500,
  items: [
    {
      description: "Product A",
      quantity: 2,
      unitPriceMinor: 1000,
      taxBps: 1000,
    },
    {
      description: "Product B",
      quantity: 1,
      unitPriceMinor: 3000,
      taxBps: 2000,
    },
  ],
};

test("discount precedes mixed tax rates; shipping is untaxed", () => {
  assert.deepEqual(invoiceTotals(document), {
    subtotal: 5000,
    tax: 640,
    total: 5140,
    lines: [
      { gross: 2000, discount: 400, net: 1600, tax: 160, total: 1760 },
      { gross: 3000, discount: 600, net: 2400, tax: 480, total: 2880 },
    ],
  });
});
test("discount allocation never creates a negative line and allocates every cent", () => {
  const doc = {
    ...document,
    discountMinor: 99,
    shippingMinor: 0,
    items: Array.from({ length: 100 }, () => ({
      description: "Item",
      quantity: 1,
      unitPriceMinor: 1,
      taxBps: 1000,
    })),
  };
  const totals = invoiceTotals(doc);
  assert.equal(
    totals.lines.reduce((sum, line) => sum + line.discount, 0),
    99,
  );
  assert.ok(totals.lines.every((line) => line.net >= 0));
  assert.equal(totals.total, 1);
});
test("large supported amounts preserve cent allocation", () => {
  const doc = {
    ...document,
    discountMinor: 99_999_999,
    items: [
      {
        description: "Bulk",
        quantity: 999,
        unitPriceMinor: 100_000_000,
        taxBps: 10000,
      },
      {
        description: "Remainder",
        quantity: 1,
        unitPriceMinor: 99_999_999,
        taxBps: 0,
      },
    ],
  };
  assert.ok(invoiceDocumentSchema.safeParse(doc).success);
  const totals = invoiceTotals(doc);
  assert.equal(
    totals.lines.reduce((sum, line) => sum + line.discount, 0),
    doc.discountMinor,
  );
  assert.ok(Number.isSafeInteger(totals.total));
});
test("rejects invalid dates, oversized discounts, fractional cents, quantities and unsupported currencies", () => {
  for (const change of [
    { dueDate: "2026-10-01" },
    { dueDate: "2026-02-30" },
    { discountMinor: 5001 },
    { currency: "JPY" },
    { items: [] },
    { items: [{ ...document.items[0], unitPriceMinor: 1.5 }] },
    { items: [{ ...document.items[0], quantity: 1.5 }] },
    { items: [{ ...document.items[0], taxBps: 10001 }] },
  ])
    assert.equal(
      invoiceDocumentSchema.safeParse({ ...document, ...change }).success,
      false,
    );
});
test("paid, partial, overdue, draft and void states respect balance and due dates", () => {
  const invoice = {
    document,
    status: "issued",
    total_minor: 5140,
    paid_minor: 0,
  } as Invoice;
  assert.equal(invoiceStatus(invoice, "2026-11-21"), "issued");
  assert.equal(invoiceStatus(invoice, "2026-11-22"), "overdue");
  assert.equal(
    invoiceStatus({ ...invoice, paid_minor: 1 }, "2026-11-21"),
    "partial",
  );
  assert.equal(
    invoiceStatus({ ...invoice, paid_minor: 5140 }, "2026-11-22"),
    "paid",
  );
  assert.equal(
    invoiceStatus({ ...invoice, status: "draft" }, "2026-11-22"),
    "draft",
  );
  assert.equal(
    invoiceStatus({ ...invoice, status: "void" }, "2026-11-22"),
    "void",
  );
});
test("payment input requires an idempotency key and positive integer cents", () => {
  const payment = {
    id: "11111111-1111-4111-8111-111111111111",
    amountMinor: 1,
    paidOn: "2026-10-22",
    method: "bank_transfer",
    reference: "REF",
  };
  assert.ok(paymentSchema.safeParse(payment).success);
  for (const change of [
    { amountMinor: 0 },
    { amountMinor: -1 },
    { amountMinor: 1.5 },
    { id: "bad" },
    { method: "unknown" },
  ])
    assert.equal(
      paymentSchema.safeParse({ ...payment, ...change }).success,
      false,
    );
});

test("total including shipping cannot exceed the database money limit", () => {
  const doc = { ...document, discountMinor: 0, shippingMinor: 1, items: [{ description: "Maximum", quantity: 1000, unitPriceMinor: 100_000_000, taxBps: 10000 }] };
  assert.equal(invoiceDocumentSchema.safeParse(doc).success, false);
  assert.equal(invoiceDocumentSchema.safeParse({ ...doc, shippingMinor: 0 }).success, true);
});

test("incomplete fractional quantity input cannot crash the editor preview", () => {
  const doc = { ...document, items: [{ ...document.items[0], quantity: 1.333 }] };
  assert.doesNotThrow(() => invoiceTotals(doc));
  assert.equal(invoiceDocumentSchema.safeParse(doc).success, false);
});
