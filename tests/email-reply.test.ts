import assert from "node:assert/strict";
import test from "node:test";
import { emailReplyInstruction, parseEmailReplyPlan, replyInvoiceLines } from "../lib/ai/email-reply.ts";
import { prepareReplyInvoice } from "../lib/email-reply-client.ts";
import { blankInvoiceDocument } from "../lib/invoices.ts";
import type { InvoiceProduct } from "../lib/invoice-links.ts";

const product: InvoiceProduct = {
  sku: "PLA-BASIC", name: "PLA Basic", currency: "USD", priceMinor: 1000, moq: 10,
  stockStatus: "In stock", tiers: [{ minimumQuantity: 500, priceMinor: 800 }],
  variants: [{ id: "black", name: "Black", sku: "PLA-BASIC-BLACK", priceMinor: 1000, stockStatus: "In stock" }],
};
const items = [{ productSku: "PLA-BASIC", variantId: "black", quantity: 500 }];

test("AI reply handles catalog requests and order intent separately from rewriting", () => {
  assert.match(emailReplyInstruction, /not rewriting/);
  assert.match(emailReplyInstruction, /catalog or catalogue/);
  assert.match(emailReplyInstruction, /500 pieces PLA basic black/);
  assert.match(emailReplyInstruction, /DRAFT invoice/);
  assert.match(emailReplyInstruction, /untrusted data/);
});

test("reply plans reject incomplete or invalid order quantities", () => {
  const plan = { body: "Here is your draft invoice.", attachCatalog: false, invoiceItems: items };
  assert.deepEqual(parseEmailReplyPlan(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``), plan);
  for (const quantity of [0, -1, 0.5, 1_000_001]) {
    assert.throws(() => parseEmailReplyPlan(JSON.stringify({ ...plan, invoiceItems: [{ ...items[0], quantity }] })));
  }
  assert.throws(() => parseEmailReplyPlan('{"body":"Hello"}'));
});

test("500 black pieces use the current quantity tier and exact variant", () => {
  const result = replyInvoiceLines(items, [product]);
  assert.equal(result.currency, "USD");
  assert.deepEqual(result.lines[0], {
    productSku: "PLA-BASIC", variantId: "black", variantSku: "PLA-BASIC-BLACK",
    description: "PLA Basic — Black", quantity: 500, unitPriceMinor: 800, taxBps: 0, pricingMode: "catalog",
  });
  assert.equal(result.lines[0].quantity * result.lines[0].unitPriceMinor, 400_000);
});

test("invoices require known products, exact variants, MOQ, prices and one currency", () => {
  assert.throws(() => replyInvoiceLines(items, []), /unavailable/);
  assert.throws(() => replyInvoiceLines([{ ...items[0], variantId: "white" }], [product]), /variant/);
  assert.throws(() => replyInvoiceLines([{ ...items[0], variantId: null }], [product]), /exact variant/);
  assert.throws(() => replyInvoiceLines([{ ...items[0], quantity: 1 }], [product]), /at least 10/);
  assert.throws(() => replyInvoiceLines(items, [{ ...product, tiers: [], priceMinor: null, variants: [{ ...product.variants[0], priceMinor: null }] }]), /Confirm pricing/);
  assert.throws(() => replyInvoiceLines([...items, { ...items[0], productSku: "EUR-PLA" }], [product, { ...product, sku: "EUR-PLA", currency: "EUR" }]), /one invoice currency/);
});

function setup() {
  const calls: string[] = [];
  let saved: Record<string, unknown> | undefined;
  let failPdf = false;
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method || "GET"} ${url}`);
    if (url.includes("kind=products")) return Response.json({ products: [product] });
    if (url.startsWith("/api/invoices/context")) return Response.json({ document: { ...blankInvoiceDocument("2026-10-23"), sellerName: "Saved seller", customerName: "Customer Ltd" } });
    if (url === "/api/invoices") {
      saved = JSON.parse(String(init?.body));
      return Response.json({ invoice: { id: "draft-id", status: "draft" } }, { status: 201 });
    }
    if (url.endsWith("/pdf")) return failPdf ? Response.json({ error: "PDF unavailable" }, { status: 503 })
      : new Response("%PDF-1.7 invoice", { headers: { "X-Invoice-Filename": "INV-000001-draft.pdf" } });
    if (url === "/api/invoices/draft-id") return Response.json({ invoice: { id: "draft-id", status: "draft" } });
    throw new Error(`Unexpected request: ${url}`);
  };
  return { calls, request, getSaved: () => saved, failPdf: (value: boolean) => { failPdf = value; } };
}

test("reply invoice uses existing billing APIs and attaches a real draft PDF without sending", async () => {
  const mock = setup();
  const pdf = await prepareReplyInvoice({ items, email: "buyer@example.com", customerName: "Buyer", threadId: "thread-1", cache: new Map(), isCurrent: () => true, request: mock.request });
  assert.equal(pdf.filename, "INV-000001-draft.pdf");
  const doc = mock.getSaved()!;
  assert.equal(doc.customerEmail, "buyer@example.com");
  assert.equal(doc.sellerName, "Saved seller");
  assert.equal(doc.currency, "USD");
  assert.deepEqual((doc.items as unknown[]).length, 1);
  assert.equal(mock.calls.filter((call) => call.startsWith("POST")).length, 1);
  assert.ok(!mock.calls.some((call) => call.includes("/send") || call.includes("/issue")));
});

test("a failed PDF retry reuses its saved draft rather than creating another invoice", async () => {
  const mock = setup();
  const input = { items, email: "buyer@example.com", customerName: "Buyer", cache: new Map<string, string>(), isCurrent: () => true, request: mock.request };
  mock.failPdf(true);
  await assert.rejects(() => prepareReplyInvoice(input), /Draft invoice saved/);
  mock.failPdf(false);
  const pdf = await prepareReplyInvoice(input);
  assert.equal(pdf.invoiceId, "draft-id");
  assert.equal(mock.calls.filter((call) => call === "POST /api/invoices").length, 1);
});

test("changing conversations prevents subsequent invoice creation", async () => {
  const mock = setup();
  let current = true;
  const request: typeof fetch = async (...args) => {
    const response = await mock.request(...args);
    current = false;
    return response;
  };
  await assert.rejects(() => prepareReplyInvoice({ items, email: "buyer@example.com", customerName: "Buyer", cache: new Map(), isCurrent: () => current, request }), /conversation changed/);
  assert.ok(!mock.calls.some((call) => call.startsWith("POST")));
});
