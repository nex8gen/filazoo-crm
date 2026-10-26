import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { invoicePortalKey, validPortalKey, hashPortalPassword, verifyPortalPassword, portalHash, portalToken } from "../lib/customer-portal-crypto.ts";
import { customerInvoice, shipmentSchema } from "../lib/customer-portal.ts";
import { blankInvoiceDocument, type Invoice } from "../lib/invoices.ts";
import { canReadInvoices, canCreateInvoices, canManageBilling } from "../lib/invoice-permissions.ts";

test("QR credentials bind to one invoice and its current billing email", () => {
  const key = invoicePortalKey("invoice-a", "Buyer@Example.com", "server-secret");
  assert.equal(validPortalKey(key, "invoice-a", " buyer@example.com ", "server-secret"), true);
  assert.equal(validPortalKey(key, "invoice-b", "buyer@example.com", "server-secret"), false);
  assert.equal(validPortalKey(key, "invoice-a", "other@example.com", "server-secret"), false);
  assert.equal(validPortalKey(key, "invoice-a", "buyer@example.com", "changed-secret"), false);
  for (const value of ["", key + "x", "!".repeat(43)]) assert.equal(validPortalKey(value, "invoice-a", "buyer@example.com", "server-secret"), false);
});
test("customer passwords use salted scrypt and reject wrong credentials", async () => {
  const hash = await hashPortalPassword("CustomerPassword!123");
  assert.notEqual(hash, await hashPortalPassword("CustomerPassword!123"));
  assert.equal(await verifyPortalPassword("CustomerPassword!123", hash), true);
  assert.equal(await verifyPortalPassword("WrongPassword!123", hash), false);
  assert.equal(await verifyPortalPassword("CustomerPassword!123", "invalid"), false);
  const token = portalToken();
  assert.equal(token.length, 43);
  assert.notEqual(token, portalToken());
  assert.equal(portalHash(token).length, 64);
});
test("customer invoice DTO excludes CRM identifiers and payment internals", () => {
  const invoice: Invoice = { id: "id", number: 8, status: "issued", total_minor: 100, paid_minor: 50, revision: 1, created_at: "", updated_at: "", created_by: "staff", source_thread_id: "secret-thread", company_id: "secret-company", customer_portal_url: "secret-key", invoice_payments: [{ id: "payment", amount_minor: 50, paid_on: "2026-10-26", method: "bank", reference: "internal-ref", created_at: "" }], document: { ...blankInvoiceDocument("2026-10-26"), companyId: "secret-company", contactId: "secret-contact", purchaseOrderId: "secret-order", sourceThreadId: "secret-thread", bankAccountId: "secret-bank" } };
  const text = JSON.stringify(customerInvoice(invoice));
  for (const secret of ["secret-company", "secret-contact", "secret-order", "secret-thread", "secret-key", "internal-ref", "secret-bank"]) assert.equal(text.includes(secret), false);
  assert.equal(customerInvoice(invoice).paid_minor, 50);
});
test("tracking links reject executable and insecure URLs", () => {
  const shipment = { status: "in_transit", location: "Shenzhen", carrier: "DHL", tracking_number: "123", expected_delivery: "2026-11-01" };
  assert.equal(shipmentSchema.safeParse({ ...shipment, tracking_url: "https://example.com/track" }).success, true);
  for (const tracking_url of ["javascript:alert(1)", "http://example.com", "data:text/html,test"]) assert.equal(shipmentSchema.safeParse({ ...shipment, tracking_url }).success, false);
});
test("customer role has no staff invoice permissions and every customer route uses scoped access", () => {
  assert.equal(canReadInvoices("customer"), false);
  assert.equal(canCreateInvoices("customer"), false);
  assert.equal(canManageBilling("customer"), false);
  for (const path of ["app/api/customer/invoices/[id]/route.ts", "app/api/customer/invoices/[id]/messages/route.ts", "app/api/customer/invoices/[id]/pdf/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /loadPortalData\(id\)|portalSession\(id\)/);
    assert.doesNotMatch(source, /mutateInvoice|invoice_payments.*insert/);
  }
});

test("customer pages and APIs bypass staff authentication before staff cookie refresh", () => {
  const source = readFileSync("lib/supabase/proxy.ts", "utf8");
  const bypass = source.indexOf("if (customerRoute)");
  const staffClient = source.indexOf("const supabase = createServerClient");
  assert.ok(bypass > 0 && bypass < staffClient);
  assert.match(source.slice(bypass, staffClient), /return response;/);
  assert.match(source, /pathname\.startsWith\("\/customer\/"\)/);
  assert.match(source, /pathname\.startsWith\("\/api\/customer\/"\)/);
});

test("old printed invoice QR links use a scoped legacy registry rather than staff sign-in", () => {
  const proxy = readFileSync("lib/supabase/proxy.ts", "utf8");
  assert.ok(proxy.indexOf('if (invoiceQr)') < proxy.indexOf('const loginUrl'));
  const route = readFileSync("app/customer/legacy/[id]/route.ts", "utf8");
  assert.match(route, /customer_portal_legacy_links/);
  assert.match(route, /\.is\("revoked_at", null\)/);
  assert.match(route, /portalEmail\(invoice\.document\.customerEmail\) !== legacy\.billing_email/);
});
