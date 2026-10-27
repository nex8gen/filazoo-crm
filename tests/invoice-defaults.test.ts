import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDefaultsSchema, invoiceDocumentWithDefaults, readInvoiceDefaults } from "../lib/invoice-defaults.ts";
import { withBillingCustomer } from "../lib/invoice-links.ts";

const customer = { id: "company", name: "Buyer", city: "London", country: "UK", contacts: [] };
test("new invoice defaults load without a saved row and apply currency, seller, due date, and initial tax", () => {
  assert.equal(readInvoiceDefaults({}).seller.sellerName, "Filazoo");
  const document = invoiceDocumentWithDefaults("2026-12-20", { sellerName: "Legal seller", notes: "Net 30", defaults: { currency: "EUR", termsDays: 30, taxBps: 1250 } });
  assert.equal(document.currency, "EUR");
  assert.equal(document.dueDate, "2027-01-19");
  assert.equal(document.sellerName, "Legal seller");
  assert.equal(document.notes, "Net 30");
  assert.equal(document.items[0].taxBps, 1250);
  assert.equal(withBillingCustomer(document, customer).dueDate, "2027-01-19");
  const specific = withBillingCustomer(document, customer, { email: "", address: "", taxId: "", currency: "GBP", termsDays: 7 });
  assert.equal(specific.currency, "GBP");
  assert.equal(specific.dueDate, "2026-12-27");
});

test("invoice defaults reject unsupported currencies, fractional terms, and invalid tax", () => {
  for (const input of [{ currency: "ZZZ" }, { termsDays: -1 }, { termsDays: 1.5 }, { termsDays: 366 }, { taxBps: 10001 }]) {
    assert.equal(invoiceDefaultsSchema.safeParse(input).success, false);
  }
});
