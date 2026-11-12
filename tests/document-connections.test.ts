import assert from "node:assert/strict";
import test from "node:test";
import { documentConnectionError, documentSourceHref, emptyDocumentConnections, documentSizeLabel } from "../lib/document-connections.ts";
import { documentCategories, documentInputSchema, documentSearchText, type LibraryDocument } from "../lib/documents.ts";

test("business document categories require the relevant CRM connections", () => {
  const customer = crypto.randomUUID(), order = crypto.randomUUID();
  assert.match(documentConnectionError("quotation", emptyDocumentConnections), /customer/);
  assert.match(documentConnectionError("quotation", { ...emptyDocumentConnections, company_id: customer }), /product/);
  assert.equal(documentConnectionError("quotation", { ...emptyDocumentConnections, company_id: customer, product_skus: ["PLA"] }), "");
  for (const category of ["proforma", "invoice", "payment"] as const) {
    assert.match(documentConnectionError(category, emptyDocumentConnections), /purchase order/);
    assert.equal(documentConnectionError(category, { ...emptyDocumentConnections, purchase_order_id: order }), "");
  }
  assert.match(documentConnectionError("datasheet", emptyDocumentConnections), /product/);
  assert.equal(documentConnectionError("general", emptyDocumentConnections), "");
  assert.equal(documentCategories.find(item => item.id === "proforma")?.label, "Draft invoices");
});

test("live invoices open the source order and use an honest size label", () => {
  const order = crypto.randomUUID();
  const invoice = { source_type: "invoice", source_id: crypto.randomUUID(), invoice_id: crypto.randomUUID(), purchase_order_id: order, mime_type: "application/pdf" } as LibraryDocument;
  assert.equal(documentSourceHref(invoice), `/purchase-orders/${order}`);
  assert.equal(documentSizeLabel(invoice), "CRM PDF · live record");
  assert.equal(documentSourceHref({ ...invoice, source_type: null }), null);
  assert.equal(documentSizeLabel({ ...invoice, source_type: null }), "");
});

test("uploaded connections are bounded and linked SKUs are searchable", () => {
  const file = { id: crypto.randomUUID(), kind: "file", name: "Quote.pdf", company_id: crypto.randomUUID(), product_skus: ["PLA-RED"] };
  assert.equal(documentInputSchema.safeParse(file).success, true);
  assert.equal(documentInputSchema.safeParse({ ...file, invoice_id: "untrusted" }).success, false);
  assert.equal(documentInputSchema.safeParse({ ...file, product_skus: Array(101).fill("PLA") }).success, false);
  assert.match(documentSearchText({ name: file.name, company: "", description: "", tags: [], subject: "", body: "", product_skus: file.product_skus }), /pla-red/);
});
