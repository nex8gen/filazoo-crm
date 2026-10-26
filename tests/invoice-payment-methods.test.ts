import test from "node:test";
import assert from "node:assert/strict";
import { invoicePaymentMethodSchema, invoicePaymentMethodsSchema, paymentMethodTitle, paymentMethodDetails } from "../lib/invoice-payment-methods.ts";
import { blankInvoiceDocument, invoiceDocumentSchema } from "../lib/invoices.ts";
import { sellerSettingsSchema } from "../lib/invoice-links.ts";
import { customerInvoice } from "../lib/customer-portal.ts";

const bank = { id: "c312416f-ab5f-4c54-a748-939c339559ac", type: "bank_transfer" as const, label: "USD account", currency: "USD" as const, details: "Beneficiary: Filazoo\nAccount: 000123456789\nSWIFT: TESTUS33", paymentUrl: "" };
const paypal = { id: "f8b4c1a9-d128-4c86-b5f1-c08a9b0ee472", type: "paypal" as const, label: "PayPal", currency: "" as const, details: "payments@example.com", paymentUrl: "https://www.paypal.me/filazoo" };
const document = { ...blankInvoiceDocument("2026-10-26"), customerName: "Customer", items: [{ description: "Item", quantity: 1, unitPriceMinor: 100, taxBps: 0 }] };

test("multiple payment methods retain bank details, PayPal links, and snapshots", () => {
  const parsed = invoiceDocumentSchema.parse({ ...document, paymentMethods: [bank, paypal] });
  assert.deepEqual(parsed.paymentMethods, [bank, paypal]);
  assert.match(parsed.paymentMethods![0].details, /000123456789/);
  const changed = { ...paypal, details: "new@example.com" };
  assert.notEqual(parsed.paymentMethods![1].details, changed.details);
  assert.equal(paymentMethodTitle(bank), "USD account (Bank transfer)");
  assert.equal(paymentMethodTitle(paypal), "PayPal");
  assert.ok(invoiceDocumentSchema.safeParse(document).success);
  assert.ok(invoiceDocumentSchema.safeParse({ ...document, paymentMethods: [] }).success);
});

test("payment methods reject unsupported invoice currencies and duplicate IDs", () => {
  assert.equal(invoiceDocumentSchema.safeParse({ ...document, currency: "EUR", paymentMethods: [bank] }).success, false);
  assert.ok(invoiceDocumentSchema.safeParse({ ...document, currency: "EUR", paymentMethods: [paypal] }).success);
  assert.equal(invoicePaymentMethodsSchema.safeParse([bank, bank]).success, false);
  assert.equal(invoicePaymentMethodsSchema.safeParse(Array.from({ length: 11 }, (_, index) => ({ ...bank, id: `c312416f-ab5f-4c54-a748-${String(index).padStart(12, "0")}` }))).success, false);
});

test("customer payment methods require usable details or a safe payment link", () => {
  assert.equal(invoicePaymentMethodSchema.safeParse({ ...bank, details: "   " }).success, false);
  assert.equal(invoicePaymentMethodSchema.safeParse({ ...paypal, details: "", paymentUrl: "" }).success, false);
  assert.ok(invoicePaymentMethodSchema.safeParse({ ...paypal, details: "" }).success);
  for (const paymentUrl of ["javascript:alert(1)", "http://paypal.me/test", "data:text/html,test", "https://user:password@example.com"]) {
    assert.equal(invoicePaymentMethodSchema.safeParse({ ...paypal, paymentUrl }).success, false);
  }
});

test("structured bank fields validate SWIFT and preserve exact account numbers in customer instructions", () => {
  const bankDetails = { beneficiaryName: "Test Manufacturing Co., Ltd.", accountNumber: "000755983500000", swift: "cmbccnbs", bankName: "Test Bank Shenzhen" };
  const method = invoicePaymentMethodSchema.parse({ ...bank, details: "", bankDetails });
  assert.equal(method.bankDetails!.swift, "CMBCCNBS");
  assert.equal(method.bankDetails!.accountNumber, bankDetails.accountNumber);
  assert.match(paymentMethodDetails(method), /Account number: 000755983500000/);
  assert.match(paymentMethodDetails(method), /Beneficiary: Test Manufacturing Co., Ltd\./);
  assert.match(paymentMethodDetails(method), /Bank name: Test Bank Shenzhen/);
  assert.ok(invoiceDocumentSchema.safeParse({ ...document, paymentMethods: [method] }).success);
  for (const key of ["beneficiaryName", "accountNumber", "swift", "bankName"]) {
    assert.equal(invoicePaymentMethodSchema.safeParse({ ...method, bankDetails: { ...bankDetails, [key]: "" } }).success, false);
  }
  assert.equal(invoicePaymentMethodSchema.safeParse({ ...method, bankDetails: { ...bankDetails, swift: "INVALID" } }).success, false);
});

test("settings do not automatically offer every saved method on new invoices", () => {
  const defaults = sellerSettingsSchema.partial().parse({ sellerName: "Filazoo", paymentMethods: [bank, paypal] });
  assert.equal("paymentMethods" in defaults, false);
});

test("customer portal includes only the invoice's selected payment details", () => {
  const invoice = customerInvoice({ id: bank.id, number: 1, status: "issued", document: { ...document, paymentMethods: [paypal] }, paid_minor: 0, total_minor: 100, revision: 1, created_at: "2026-10-26", updated_at: "2026-10-26" });
  assert.deepEqual(invoice.document.paymentMethods, [paypal]);
  assert.equal(JSON.stringify(invoice).includes(bank.details), false);
});
