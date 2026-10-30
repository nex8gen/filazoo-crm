import assert from "node:assert/strict";
import test from "node:test";
import { buildQuotation, quotationActionSchema, quotationDocumentSchema, quotationOrder, quotationShareBlockers, quotationState, quotationToday, type QuotationInput } from "../lib/quotations.ts";
import { crmProduct } from "../lib/product-utils.ts";
import { purchaseOrderSchema, purchaseOrderTotal } from "../lib/purchase-orders.ts";

const product = crmProduct({ sku: "PLA", name: "PLA Basic", image_url: null, material: null, diameter: null, weight: null, lead_time: null, sheet_updated_at: null, currency: "USD", price: "5.31", moq: 10, color: "", stock_status: "Available", tags: ["price-tier:10:5.31", "price-tier:100:5.00"], active: true });
const base = { sellerName: "Filazoo", sellerAddress: "China", customerName: "QA Customer", currency: "USD" as const, issueDate: "2026-10-30" };
const input = (): QuotationInput => ({ validUntil: "2026-11-13", customerEmail: "qa@example.test", billingAddress: "Billing address", taxId: "QA", shippingAddress: "Shipping address", shippingRecipient: "QA", shippingPhone: "", shippingMinor: 1234, shippingConfirmed: true, preShipmentPercent: 30, paymentTerms: "30% deposit, balance before shipment", notes: "QA only", items: [{ productSku: "PLA", quantity: 100, pricingMode: "saved" }] });

test("quotations freeze tier prices, calculate exact money and reject injected totals", () => {
  const doc = buildQuotation(input(), [product], base);
  assert.equal(doc.items[0].unitPriceMinor, 500); assert.equal(doc.subtotalMinor, 50000); assert.equal(doc.totalMinor, 51234);
  assert.equal(product.price, "$5.31");
  assert.equal(quotationDocumentSchema.safeParse({ ...doc, totalMinor: 1 }).success, false);
  assert.throws(() => buildQuotation({ ...input(), totalMinor: 1 } as QuotationInput, [product], base));
  assert.equal(buildQuotation(input(), [product], base).items[0].unitPriceMinor, 500);
});
test("saved prices ignore a forged unit amount and require an explicit agreed-price mode", () => {
  const value = input(); value.items[0].unitPriceMinor = 1;
  assert.equal(buildQuotation(value, [product], base).items[0].unitPriceMinor, 500);
  value.items[0] = { ...value.items[0], quantity: 1 }; assert.throws(() => buildQuotation(value, [product], base), /minimum/);
  value.items[0].pricingMode = "agreed"; assert.equal(buildQuotation(value, [product], base).totalMinor, 1235);
});
test("saved selections reject another product, currency, unsupported variant and ambiguous variant", () => {
  assert.throws(() => buildQuotation(input(), [], base), /saved selection/);
  assert.throws(() => buildQuotation(input(), [{ ...product, currency: "EUR" }], base), /currency/);
  const value = input(); value.items[0].variantId = "missing"; assert.throws(() => buildQuotation(value, [product], base), /variant/);
  delete value.items[0].variantId;
  const p = { ...product, variants: [{ id: "red", name: "Red", sku: "PLA-R", price: "$6.12", stockStatus: "Available", imageUrl: null }, { id: "blue", name: "Blue", sku: "PLA-B", price: "$6.12", stockStatus: "Available", imageUrl: null }] };
  assert.throws(() => buildQuotation(value, [p], base), /variant/);
  value.items[0].variantId = "blue"; const line = buildQuotation(value, [p], base).items[0]; assert.equal(line.sku, "PLA-B"); assert.equal(line.variantSku, "PLA-B"); assert.equal(line.unitPriceMinor, 612);
});
test("invalid quantities, fractional cents, huge totals and reversed validity never become saved quotations", () => {
  for (const quantity of [0, -1, 1.5, 1000001]) { const value = input(); value.items[0].quantity = quantity; assert.throws(() => buildQuotation(value, [product], base)); }
  for (const unitPriceMinor of [-1, 0.5, 100000001]) { const value = input(); value.items[0] = { ...value.items[0], pricingMode: "agreed", unitPriceMinor }; assert.throws(() => buildQuotation(value, [product], base)); }
  assert.throws(() => buildQuotation({ ...input(), validUntil: "2026-10-29" }, [product], base));
  const value = input(); value.items = Array.from({ length: 99 }, () => ({ productSku: "PLA", quantity: 1000000, pricingMode: "agreed", unitPriceMinor: 100000000 })); assert.throws(() => buildQuotation(value, [product], base));
});
test("sharing requires a saved valid offer, explicit freight confirmation and payment terms", () => {
  assert.equal(quotationShareBlockers(null).length, 1);
  const doc = buildQuotation(input(), [product], base);
  assert.equal(quotationShareBlockers(doc, "2026-11-13").length, 0); assert.equal(quotationShareBlockers(doc, "2026-11-14").length, 1);
  assert.equal(quotationShareBlockers({ ...doc, shippingMinor: 0, shippingConfirmed: false, paymentTerms: " " }, "2026-10-30").length, 2);
});
test("expiry uses China business dates and cannot erase accepted or converted status", () => {
  assert.equal(quotationToday(new Date("2026-10-30T16:01:00Z")), "2026-10-31");
  const doc = buildQuotation(input(), [product], base);
  assert.equal(quotationState({ quote_status: "shared", quote_document: doc, quote_order_id: null }, "2026-11-14"), "expired");
  assert.equal(quotationState({ quote_status: "accepted", quote_document: doc, quote_order_id: null }, "2026-11-14"), "accepted");
  assert.equal(quotationState({ quote_status: "accepted", quote_document: doc, quote_order_id: "order" }), "converted");
});
test("conversion preserves accepted amounts, SKU, customer and terms in a draft with reservable freight", () => {
  const doc = buildQuotation(input(), [product], base); const order = purchaseOrderSchema.parse(quotationOrder(doc, "Q-QA-V1", () => true, false));
  assert.equal(order.status, "draft"); assert.equal(order.items.length, 2); assert.equal(order.items[0].pricingMode, "manual"); assert.equal(order.items[0].unitPriceMinor, 500);
  assert.equal(order.items[1].sku, "FREIGHT"); assert.equal(order.items[1].quantity, 1); assert.equal(order.items[1].productSku, undefined);
  assert.equal(purchaseOrderTotal(order.items), doc.totalMinor); assert.equal(order.preShipmentPercent, 30); assert.equal(order.paymentTerms, doc.paymentTerms);
  assert.equal(order.customer?.billingAddress, doc.billingAddress); assert.equal(order.shippingAddress, doc.shippingAddress);
});
test("unavailable products require explicit custom-item permission and retain exact accepted identity", () => {
  const doc = buildQuotation(input(), [product], base);
  assert.throws(() => quotationOrder(doc, "Q-QA", () => false, false), /Allow custom/);
  const order = purchaseOrderSchema.parse(quotationOrder(doc, "Q-QA", () => false, true)); assert.equal(order.items[0].productSku, undefined); assert.equal(order.items[0].sku, "PLA"); assert.match(order.items[0].description, /SKU: PLA/); assert.equal(purchaseOrderTotal(order.items), doc.totalMinor);
  assert.equal(quotationOrder({ ...doc, shippingMinor: 0, totalMinor: doc.subtotalMinor }, "Q-QA", () => true, false).items.length, 1);
});
test("mutation inputs reject spoofed owners, negative revisions, empty acceptance and oversized selections", () => {
  assert.equal(quotationActionSchema.safeParse({ action: "accept", revision: 2, note: " " }).success, false);
  assert.equal(quotationActionSchema.safeParse({ action: "share", revision: -1 }).success, false);
  assert.equal(quotationActionSchema.safeParse({ action: "share", revision: 1, user_id: "other" }).success, false);
  const value = input(); value.items = Array.from({ length: 100 }, () => value.items[0]); assert.equal(quotationActionSchema.safeParse({ action: "save", revision: 1, document: value }).success, false);
});
