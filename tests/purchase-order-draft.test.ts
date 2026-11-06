import assert from "node:assert/strict";
import test from "node:test";
import { blankPurchaseOrder, changeDraftQuantity, draftPaymentTotals, orderProductChoices, orderShippingSku, productSelectionKey, purchaseOrderCommercialDetailsLocked, purchaseOrderEditorDocument } from "../lib/purchase-order-draft.ts";
import { purchaseOrderCreateSchema, purchaseOrderLabel, purchaseOrderSchema, type PurchaseOrder } from "../lib/purchase-orders.ts";
import { commerceDefaults } from "../lib/company-commerce.ts";
import { purchaseOrderSearchFilter } from "../lib/purchase-order-overview.ts";
import type { InvoiceProduct } from "../lib/invoice-links.ts";

const product: InvoiceProduct = {
  sku: "PLA", name: "PLA filament", imageUrl: null, currency: "USD", priceMinor: 500, moq: 10, stockStatus: "In stock",
  tiers: [{ minimumQuantity: 10, priceMinor: 500 }, { minimumQuantity: 100, priceMinor: 450 }],
  variants: [{ id: "black", sku: "PLA-BLACK", name: "Black", imageUrl: null, priceMinor: 500, stockStatus: "In stock" }, { id: "white", sku: "PLA-WHITE", name: "White", imageUrl: null, priceMinor: 500, stockStatus: "In stock" }],
};

test("new orders start empty and can receive an automatic reference only at creation", () => {
  const blank = blankPurchaseOrder("2026-11-06");
  assert.deepEqual(blank.items, []);
  assert.equal(blank.reference, "");
  assert.equal(purchaseOrderCreateSchema.safeParse(blank).success, false, "Empty orders cannot be saved");
  const draft = { ...blank, items: [{ description: "Custom", sku: "", quantity: 1, unitPriceMinor: 100 }] };
  assert.equal(purchaseOrderCreateSchema.safeParse(draft).success, true);
  assert.equal(purchaseOrderSchema.safeParse(draft).success, false, "Stored orders require the allocated reference");
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...draft, deliveryDate: "2026-11-05" }).success, false);
  assert.equal(purchaseOrderCreateSchema.safeParse({ ...draft, tags: ["x".repeat(41)] }).success, false);
});

test("variant selections preserve identifiers, images, MOQ and prices for multiple lines", () => {
  const choices = orderProductChoices(product);
  assert.equal(choices.length, 2);
  assert.notEqual(choices[0].key, choices[1].key);
  assert.equal(choices[0].key, productSelectionKey("PLA", "black"));
  assert.equal(choices[1].item.variantId, "white");
  assert.equal(choices[0].item.quantity, 10);
  assert.equal(choices[0].item.unitPriceMinor, 500);
  assert.equal(choices[0].item.sku, "PLA-BLACK");
});

test("quantity changes reprice catalog tiers while preserving an agreed manual price", () => {
  const item = orderProductChoices(product)[0].item;
  assert.equal(changeDraftQuantity(item, 100, product).unitPriceMinor, 450);
  assert.equal(changeDraftQuantity({ ...item, pricingMode: "manual", unitPriceMinor: 479 }, 100, product).unitPriceMinor, 479);
});

test("payment totals keep delivery charges separate without losing them from the stored items", () => {
  const items = [...orderProductChoices(product).map(choice => choice.item), { description: "Freight", sku: orderShippingSku, quantity: 1, unitPriceMinor: 1234 }];
  assert.deepEqual(draftPaymentTotals(items), { subtotal: 10000, shipping: 1234, quantity: 20, total: 11234 });
});

test("automatic numbers display with # and can be searched without replacing external references", () => {
  const document = { ...blankPurchaseOrder("2026-11-06"), reference: "CUSTOMER-42" };
  assert.equal(purchaseOrderLabel({ number: 1003, document }), "#1003");
  assert.equal(purchaseOrderLabel({ document }), "CUSTOMER-42");
  assert.equal(purchaseOrderSearchFilter("%#1003%", []), 'reference.ilike."%#1003%",number.eq.1003');
  assert.equal(purchaseOrderSearchFilter("%1003%", []), 'reference.ilike."%1003%",number.eq.1003');
});

test("editing starts from the saved commercial snapshot rather than current customer defaults", () => {
  const customer = { companyName: "Saved customer", contactName: "Saved contact", contactRole: "Buyer", contactEmail: "saved@example.test", billingEmail: "saved@example.test", billingAddress: "Saved billing address", taxId: "", phone: "" };
  const saved: PurchaseOrder = { id: "order", company_id: "company", number: 1006, version: 4, created_at: "2026-11-06T08:00:00Z", total_minor: 4790,
    document: { ...blankPurchaseOrder("2026-10-30"), customer, reference: "EXTERNAL-42", notes: "Keep this note", tags: ["Priority"], shippingAddress: "Saved shipping address", items: [{ ...orderProductChoices(product)[0].item, pricingMode: "manual", unitPriceMinor: 479 }] } };
  const profile = { customer: { ...customer, companyName: "Current profile", billingAddress: "Changed address" }, commerce: commerceDefaults({ currency: "EUR", shippingAddress: "New shipping address" }), contacts: [] };
  const edited = purchaseOrderEditorDocument("2026-11-06", profile, saved);
  assert.deepEqual(edited, saved.document);
  assert.equal(edited.items[0].unitPriceMinor, 479);
  assert.equal(edited.currency, "USD");
  assert.equal(edited.orderDate, "2026-10-30");
  const legacy = purchaseOrderEditorDocument("2026-11-06", profile, { ...saved, document: { ...saved.document, customer: undefined } });
  assert.deepEqual(legacy.customer, profile.customer);
  assert.equal(legacy.shippingAddress, "Saved shipping address");
});

test("invoice reservations lock commercial fields until every linked invoice is void", () => {
  const saved: PurchaseOrder = { id: "order", company_id: "company", version: 1, created_at: "", total_minor: 5000, document: { ...blankPurchaseOrder("2026-11-06"), reference: "#1006", items: [orderProductChoices(product)[0].item] } };
  assert.equal(purchaseOrderCommercialDetailsLocked(saved), false);
  for (const status of ["draft", "issued", "void"] as const) {
    saved.invoices = [{ id: "invoice", number: 1, status, total_minor: 5000, paid_minor: 0, document: { currency: "USD", items: [{ purchaseOrderLineId: "line-1", quantity: 10 }] } }];
    assert.equal(purchaseOrderCommercialDetailsLocked(saved), status !== "void");
  }
});

test("quantity edits refresh current product metadata while retaining negotiated prices", () => {
  const item = { ...orderProductChoices(product)[0].item, pricingMode: "manual" as const, unitPriceMinor: 479 };
  const refreshed = changeDraftQuantity(item, 100, { ...product, name: "New product name", imageUrl: "/new-product.jpg" });
  assert.equal(refreshed.unitPriceMinor, 479);
  assert.equal(refreshed.quantity, 100);
  assert.equal(refreshed.description, "New product name — Black");
  assert.equal(refreshed.imageUrl, "/new-product.jpg");
  assert.equal(refreshed.pricingMode, "manual");
});

test("a removed variant is never silently replaced when editing its quantity", () => {
  const item = orderProductChoices(product)[0].item;
  const changedCatalog = { ...product, variants: product.variants.filter(variant => variant.id !== "black") };
  const updated = changeDraftQuantity(item, 100, changedCatalog);
  assert.equal(updated.variantId, "black");
  assert.equal(updated.sku, "PLA-BLACK");
  assert.equal(updated.unitPriceMinor, item.unitPriceMinor);
  assert.equal(updated.description, item.description);
});
