import test from "node:test";
import assert from "node:assert/strict";
import { invoiceBankAccountSchema, invoiceBankFields } from "../lib/invoice-banks.ts";
import { blankInvoiceDocument, invoiceDocumentSchema } from "../lib/invoices.ts";

const account = invoiceBankAccountSchema.parse({
  id: "c312416f-ab5f-4c54-a748-939c339559ac", label: "Test bank USD", currency: "USD",
  beneficiaryName: "Test beneficiary", beneficiaryAddress: "Test address",
  accountNumber: "000123456789", bankName: "Test bank", bankAddress: "Test bank address",
  swift: "TESTUS33", bankCode: "009",
});
function document() {
  const doc = blankInvoiceDocument("2026-10-23");
  return { ...doc, customerName: "Test customer", items: [{ description: "Test item", quantity: 1, unitPriceMinor: 100, taxBps: 0 }] };
}
test("bank snapshots preserve leading zeros and optional bank codes", () => {
  assert.equal(account.accountNumber, "000123456789");
  assert.deepEqual(invoiceBankFields(account).find(([label]) => label === "Bank code"), ["Bank code", "009"]);
  assert.ok(!invoiceBankFields({ ...account, currency: null, bankCode: "" }).some(([label]) => label === "Account currency" || label === "Bank code"));
  const printedFields = invoiceBankFields(account, false);
  assert.ok(!printedFields.some(([label]) => label.includes("address")));
  assert.ok(printedFields.some(([label]) => label === "SWIFT / BIC"));
});
test("saved bank snapshots survive invoice parsing; legacy manual instructions remain valid", () => {
  const parsed = invoiceDocumentSchema.parse({ ...document(), bankAccountId: account.id, bankAccount: account });
  assert.deepEqual(parsed.bankAccount, account);
  assert.ok(invoiceDocumentSchema.safeParse(document()).success);
  assert.ok(invoiceDocumentSchema.safeParse({ ...document(), bankAccountId: account.id }).success);
});
test("bank selection rejects orphan snapshots and currency mismatches", () => {
  assert.equal(invoiceDocumentSchema.safeParse({ ...document(), bankAccount: account }).success, false);
  assert.equal(invoiceDocumentSchema.safeParse({ ...document(), currency: "HKD", bankAccountId: account.id, bankAccount: account }).success, false);
  assert.ok(invoiceDocumentSchema.safeParse({ ...document(), currency: "HKD", bankAccountId: account.id, bankAccount: { ...account, currency: null } }).success);
});
