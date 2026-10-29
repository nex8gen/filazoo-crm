import assert from "node:assert/strict";
import test from "node:test";
import { blankInvoiceDocument } from "../lib/invoices.ts";
import { commerceDefaults } from "../lib/company-commerce.ts";
import {
  invoiceProduct,
  type InvoiceProductRow,
} from "../lib/invoice-links.ts";
import {
  purchaseOrderSchema,
  type OrderProfile,
} from "../lib/purchase-orders.ts";
import {
  applyOrderProfile,
  orderProductLine,
  orderProductError,
  orderInvoiceItem,
  orderInvoiceProductMatches,
  applyOrderCustomerToInvoice,
  refreshOrderProductLine,
  customOrderLine,
} from "../lib/purchase-order-links.ts";

const product = invoiceProduct({
  sku: "PLA",
  name: "PLA Basic",
  image_url: "https://example.com/pla.jpg",
  currency: "USD",
  price: 10,
  moq: 5,
  color: "White, Black",
  stock_status: "In stock",
  active: true,
  tags: ["price-tier:5:10", "price-tier:100:8"],
} satisfies InvoiceProductRow);
const document = purchaseOrderSchema.parse({
  reference: "PO-1",
  orderDate: "2026-10-26",
  deliveryDate: "",
  currency: "USD",
  status: "confirmed",
  shippingAddress: "",
  shippingPhone: "",
  shippingRecipient: "",
  notes: "",
  items: [
    {
      description: "Custom sample",
      sku: "CUSTOM",
      quantity: 1,
      unitPriceMinor: 100,
    },
  ],
});
const profile: OrderProfile = {
  customer: {
    companyName: "Customer Ltd",
    contactId: "00000000-0000-4000-8000-000000000001",
    contactName: "Buyer",
    contactRole: "Purchasing",
    contactEmail: "buyer@example.com",
    billingEmail: "accounts@example.com",
    billingAddress: "Billing street",
    taxId: "VAT1",
    phone: "+1 555",
  },
  commerce: commerceDefaults({
    shippingAddress: "Warehouse street",
    shippingRecipient: "Receiving",
    shippingPhone: "+1 777",
    email: "accounts@example.com",
  }),
  contacts: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Buyer",
      role: "Purchasing",
      email: "buyer@example.com",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Other buyer",
      role: "Manager",
      email: "other@example.com",
    },
  ],
};

test("PO catalog lines retain product and variant identities, images, MOQ and quantity price tiers", () => {
  const variant = product.variants[0];
  const line = orderProductLine(product, 100, variant?.id);
  assert.equal(line.productSku, "PLA");
  assert.equal(line.sku, variant?.sku || "PLA");
  assert.equal(line.variantId, variant?.id);
  assert.equal(line.unitPriceMinor, 800);
  assert.equal(line.imageUrl, product.imageUrl);
  assert.equal(orderProductError(line, product, "USD"), null);
  assert.equal(
    purchaseOrderSchema.parse({ ...document, items: [line] }).items[0]
      .productSku,
    "PLA",
  );
});
test("PO save validation rejects wrong currency, identity, stale prices, MOQ and inactive products", () => {
  const line = orderProductLine(product, 100);
  for (const changed of [
    { ...line, sku: "OTHER" },
    { ...line, variantId: "missing" },
    { ...line, quantity: 1 },
    { ...line, unitPriceMinor: 999 },
    { ...line, description: "Wrong product" },
    { ...line, imageUrl: "https://example.com/other.jpg" },
  ])
    assert.ok(orderProductError(changed, product, "USD"));
  assert.ok(orderProductError(line, product, "EUR"));
  assert.ok(orderProductError(line, undefined, "USD"));
  assert.equal(
    orderProductError(
      { ...line, unitPriceMinor: 700, pricingMode: "manual" },
      product,
      "USD",
    ),
    null,
  );
  assert.equal(orderProductError(document.items[0], undefined, "USD"), null);
});
test("refreshing catalog pricing also refreshes changed names and images so the order can save", () => {
  const line = orderProductLine(product, 100);
  const changed = { ...product, name: "Renamed PLA", imageUrl: "https://example.com/new.jpg", tiers: [{ minimumQuantity: 100, priceMinor: 750 }] };
  assert.ok(orderProductError(line, changed, "USD"));
  const refreshed = refreshOrderProductLine(line, changed, true);
  assert.equal(refreshed.description, "Renamed PLA");
  assert.equal(refreshed.imageUrl, changed.imageUrl);
  assert.equal(refreshed.unitPriceMinor, 750);
  assert.equal(orderProductError(refreshed, changed, "USD"), null);
});

test("refreshing details preserves an agreed price and converting to custom removes all catalog metadata", () => {
  const line = { ...orderProductLine(product, 100), unitPriceMinor: 650, pricingMode: "manual" as const };
  const changed = { ...product, name: "Current PLA", imageUrl: "https://example.com/current.jpg" };
  const refreshed = refreshOrderProductLine(line, changed, false);
  assert.equal(refreshed.unitPriceMinor, 650);
  assert.equal(refreshed.pricingMode, "manual");
  assert.equal(orderProductError(refreshed, changed, "USD"), null);
  const custom = customOrderLine(refreshed);
  assert.deepEqual(custom, { description: "Current PLA", sku: product.sku, quantity: 100, unitPriceMinor: 650 });
  assert.equal(purchaseOrderSchema.safeParse({ ...document, items: [custom] }).success, true);
});

test("new linked product writes require an explicit pricing mode while historical snapshots remain readable", () => {
  const line = { ...orderProductLine(product, 100), pricingMode: undefined };
  assert.equal(purchaseOrderSchema.safeParse({ ...document, items: [line] }).success, true);
  assert.match(orderProductError(line, product, "USD")!, /pricing|price/);
});

test("profile refresh copies contact/billing/shipping without altering order items, reference or payment policy", () => {
  const next = applyOrderProfile(document, profile);
  assert.equal(next.customer?.companyName, "Customer Ltd");
  assert.equal(next.customer?.billingEmail, "accounts@example.com");
  assert.equal(next.customer?.taxId, "VAT1");
  assert.equal(next.shippingAddress, "Warehouse street");
  assert.equal(next.shippingPhone, "+1 777");
  assert.deepEqual(next.items, document.items);
  assert.equal(next.reference, document.reference);
  assert.equal(next.paymentPolicy, "full_before_shipment");
  const other = applyOrderProfile(document, profile, profile.contacts[1].id);
  assert.equal(other.customer?.contactEmail, "other@example.com");
  assert.equal(other.customer?.billingEmail, "accounts@example.com");
  profile.customer.companyName = "Renamed profile";
  assert.equal(next.customer?.companyName, "Customer Ltd");
});
test("partial invoices retain agreed order product price even when catalog pricing later changes", () => {
  const source = orderProductLine(product, 100, product.variants[0]?.id);
  const line = orderInvoiceItem(source, 40, "line-1");
  assert.equal(line.quantity, 40);
  assert.equal(line.unitPriceMinor, 800);
  assert.equal(line.pricingMode, "manual");
  assert.equal(line.productSku, source.productSku);
  assert.equal(line.variantSku, source.variantSku);
  assert.equal(orderInvoiceProductMatches(line, source), true);
  assert.equal(
    orderInvoiceProductMatches({ ...line, productSku: "OTHER" }, source),
    false,
  );
  assert.equal(
    orderInvoiceProductMatches({ ...line, unitPriceMinor: 1000 }, source),
    false,
  );
});
test("invoice billing comes from the saved order snapshot and preserves text for a removed contact", () => {
  const order = applyOrderProfile(document, profile);
  const invoice = applyOrderCustomerToInvoice(
    blankInvoiceDocument("2026-10-26"),
    order,
    profile.contacts.map((contact) => contact.id),
  );
  assert.equal(invoice.customerAddress, "Billing street");
  assert.equal(invoice.customerEmail, "accounts@example.com");
  assert.equal(invoice.customerTaxId, "VAT1");
  assert.equal(invoice.contactId, profile.customer.contactId);
  const removedContact = applyOrderCustomerToInvoice(invoice, order, []);
  assert.equal(removedContact.contactId, undefined);
  assert.equal(removedContact.customerEmail, invoice.customerEmail);
});
