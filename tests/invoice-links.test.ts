import test from "node:test";
import assert from "node:assert/strict";
import {
  blankInvoiceDocument,
  invoiceDocumentSchema,
} from "../lib/invoices.ts";
import {
  billingProfileSchema,
  invoiceProduct,
  productInvoiceLine,
  productUnitPrice,
  quotedMinor,
  withBillingCustomer,
  type BillingCustomer,
  type InvoiceProductRow,
} from "../lib/invoice-links.ts";
import { variantTag } from "../lib/product-utils.ts";

const row: InvoiceProductRow = {
  sku: "PLA",
  name: "PLA Basic",
  currency: "USD",
  price: "5.31",
  moq: 1,
  color: "White, Black",
  stock_status: "Quote available",
  active: true,
  tags: ["price-tier:1:5.31", "price-tier:100:5.00", "price-tier:500:4.79"],
};
test("catalog quotes use exact cents; ranges and absent quotes require manual prices", () => {
  assert.equal(quotedMinor("$5.31"), 531);
  assert.equal(quotedMinor("USD 1,234.56"), 123456);
  assert.equal(quotedMinor("0.00"), 0);
  for (const value of [
    "—",
    "",
    "5.00–7.00",
    "USD 1.234",
    "Ask for quote",
    "5e3",
  ])
    assert.equal(quotedMinor(value), null);
});
test("quantity tiers use the highest eligible break and retain variant identity", () => {
  const product = invoiceProduct(row);
  assert.equal(productUnitPrice(product, 99), 531);
  assert.equal(productUnitPrice(product, 100), 500);
  assert.equal(productUnitPrice(product, 500), 479);
  const line = productInvoiceLine(product, 500, product.variants[1].id);
  assert.equal(line.variantSku, "PLA-02");
  assert.equal(line.productSku, "PLA");
  assert.equal(line.pricingMode, "catalog");
  assert.equal(line.unitPriceMinor, 479);
  assert.ok(line.description.includes("Black"));
});
test("individually priced variants are not overwritten by parent quantity tiers", () => {
  const product = invoiceProduct({
    ...row,
    tags: [
      ...row.tags,
      variantTag([
        {
          id: "premium",
          name: "Premium",
          sku: "PLA-PREMIUM",
          price: "$7.15",
          stockStatus: "Available",
          imageUrl: null,
        },
      ]),
    ],
  });
  assert.equal(productUnitPrice(product, 500, "premium"), 715);
  assert.equal(productUnitPrice(product, 500, "missing"), null);
});
test("unknown catalog prices become explicit manual lines", () => {
  const product = invoiceProduct({ ...row, price: null, tags: [] });
  assert.equal(productInvoiceLine(product, 1).pricingMode, "manual");
});
const customer: BillingCustomer = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Customer company",
  city: "Paris",
  country: "France",
  contacts: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "First",
      email: "first@example.com",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Buyer",
      email: "buyer@example.com",
    },
  ],
};
test("customer selection copies billing defaults, terms and the intended contact", () => {
  const profile = {
    address: "Saved billing address",
    taxId: "TAX-ID",
    email: "accounts@example.com",
    currency: "EUR" as const,
    termsDays: 45,
  };
  const doc = withBillingCustomer(
    blankInvoiceDocument("2026-10-23"),
    customer,
    profile,
    customer.contacts[1].id,
  );
  assert.equal(doc.companyId, customer.id);
  assert.equal(doc.contactId, customer.contacts[1].id);
  assert.equal(doc.customerEmail, "accounts@example.com");
  assert.equal(doc.customerAddress, profile.address);
  assert.equal(doc.currency, "EUR");
  assert.equal(doc.dueDate, "2026-12-07");
});
test("selecting another customer never changes currency on an already populated invoice", () => {
  const doc = blankInvoiceDocument("2026-10-23");
  doc.items[0].description = "Agreed line";
  const next = withBillingCustomer(doc, customer, {
    address: "",
    taxId: "",
    email: "",
    currency: "EUR",
    termsDays: 0,
  });
  assert.equal(next.currency, "USD");
  assert.equal(next.customerEmail, customer.contacts[0].email);
  assert.equal(next.dueDate, doc.issueDate);
});
test("invoice metadata is validated and preserved while legacy invoices remain valid", () => {
  const doc = blankInvoiceDocument("2026-10-23");
  doc.customerName = "Buyer";
  doc.items = [
    { description: "Custom", quantity: 1, unitPriceMinor: 500, taxBps: 0 },
  ];
  assert.ok(invoiceDocumentSchema.safeParse(doc).success);
  assert.equal(
    invoiceDocumentSchema.safeParse({
      ...doc,
      contactId: customer.contacts[0].id,
    }).success,
    false,
  );
  const linked = {
    ...doc,
    companyId: customer.id,
    contactId: customer.contacts[0].id,
    sourceThreadId: "thread-123",
    items: [productInvoiceLine(invoiceProduct(row), 100)],
  };
  assert.deepEqual(invoiceDocumentSchema.parse(linked), linked);
  assert.equal(
    invoiceDocumentSchema.safeParse({
      ...doc,
      items: [{ ...doc.items[0], pricingMode: "catalog" }],
    }).success,
    false,
  );
});
test("billing defaults reject invalid terms, emails and unsupported currencies", () => {
  const profile = {
    address: "",
    taxId: "",
    email: "",
    currency: "USD",
    termsDays: 30,
  };
  assert.ok(billingProfileSchema.safeParse(profile).success);
  for (const change of [
    { termsDays: -1 },
    { termsDays: 366 },
    { termsDays: 1.5 },
    { currency: "JPY" },
    { email: "invalid" },
  ])
    assert.equal(
      billingProfileSchema.safeParse({ ...profile, ...change }).success,
      false,
    );
});

test("customer prefill preserves a draft while its issue date is temporarily empty", () => {
  const doc = { ...blankInvoiceDocument("2026-10-23"), issueDate: "" };
  const next = withBillingCustomer(doc, customer);
  assert.equal(next.dueDate, doc.dueDate);
  assert.equal(next.companyId, customer.id);
  assert.equal(invoiceDocumentSchema.safeParse(next).success, false);
});
