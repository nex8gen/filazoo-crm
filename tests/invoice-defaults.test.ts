import assert from "node:assert/strict";
import test from "node:test";
import { invoiceDefaultsSchema, invoiceDocumentWithDefaults, readInvoiceDefaults } from "../lib/invoice-defaults.ts";
import { withBillingCustomer } from "../lib/invoice-links.ts";
import { buildAgentInvoice } from "../lib/ai/agent-actions.ts";

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

test("a shipping-only customer profile preserves workspace currency and terms and prepares a valid invoice", () => {
  const base = invoiceDocumentWithDefaults("2026-10-29", { defaults: { currency: "USD", termsDays: 14 } });
  const linked = withBillingCustomer(base, { ...customer, id: "a1111111-1111-4111-8111-111111111111" }, { shippingRecipient: "Audit Receiver", shippingAddress: "100 Test Avenue", shippingPhone: "TEST PHONE" });
  assert.equal(linked.currency, "USD"); assert.equal(linked.dueDate, "2026-11-12");
  assert.equal(linked.shippingRecipient, "Audit Receiver"); assert.equal(linked.shippingAddress, "100 Test Avenue"); assert.equal(linked.shippingPhone, "TEST PHONE");
  const document = buildAgentInvoice(linked, { items: [{ productSku: "PLA", quantity: 100 }] }, [{ sku: "PLA", name: "PLA", currency: "USD", moq: 1, priceMinor: 566, tiers: [], variants: [], imageUrl: null, stockStatus: "Available" }], []);
  assert.equal(document.currency, "USD"); assert.equal(document.items[0].quantity, 100); assert.equal(document.items[0].unitPriceMinor, 566);
  assert.equal(document.shippingAddress, "100 Test Avenue");
});

test("changing customer clears another customer's shipping and keeps populated invoice currency", () => {
  const base = { ...invoiceDocumentWithDefaults("2026-10-29", { defaults: { currency: "EUR", termsDays: 14 } }), shippingAddress: "Another customer's private address", shippingRecipient: "Old buyer", shippingPhone: "Old phone", items: [{ description: "Agreed line", quantity: 1, unitPriceMinor: 500, taxBps: 0 }] };
  const linked = withBillingCustomer(base, customer, { currency: "GBP", termsDays: 0 });
  assert.equal(linked.currency, "EUR"); assert.equal(linked.shippingAddress, ""); assert.equal(linked.shippingRecipient, ""); assert.equal(linked.shippingPhone, "");
  assert.equal(linked.dueDate, "2026-10-29"); assert.equal(linked.items[0].description, "Agreed line");
});

test("invalid saved billing currency and terms do not silently become a different commercial agreement", () => {
  const base = invoiceDocumentWithDefaults("2026-10-29", {});
  assert.throws(() => withBillingCustomer(base, customer, { currency: "ZZZ" as "USD" }), /billing currency is invalid/);
  assert.throws(() => withBillingCustomer(base, customer, { termsDays: -1 }), /payment terms are invalid/);
});
