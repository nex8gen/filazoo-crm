import test from "node:test";
import assert from "node:assert/strict";
import { AgentClarificationError, buildAgentInvoice, groundInvoiceVariant } from "../lib/ai/agent-actions.ts";
import { extractAgentQuestion, isBareInvoiceRequest, isInvoiceDetailQuestion } from "../lib/ai/workspace-assistant.ts";
import { pendingInvoicePrompt } from "../lib/ai/chat-history.ts";
import { blankInvoiceDocument } from "../lib/invoices.ts";
import type { InvoiceProduct } from "../lib/invoice-links.ts";

const product: InvoiceProduct = { sku: "SILK", name: "Silk PLA Two-tone", currency: "USD", moq: 1, priceMinor: 500, tiers: [], stockStatus: "Available", imageUrl: null,
  variants: [
    { id: "red-gold", name: "Red Gold", sku: "SILK-01", priceMinor: 566, stockStatus: "Available", imageUrl: null },
    { id: "black-gold", name: "Black Gold", sku: "SILK-02", priceMinor: 650, stockStatus: "Available", imageUrl: null },
  ] };
const selection = { items: [{ productSku: "SILK", variantId: "red-gold", quantity: 100 }] };
const user = (content: string) => ({ role: "user", content });

test("a focused question is accepted alone and cannot hide reads, actions or malformed JSON", () => {
  assert.equal(extractAgentQuestion('FILAZOO_QUESTION_JSON: {"question":"Which customer should I use?"}')?.question, "Which customer should I use?");
  assert.equal(extractAgentQuestion("Which products and quantities?"), null);
  for (const output of [
    'FILAZOO_QUESTION_JSON: {"question":"Which customer?"}\nFILAZOO_ACTIONS_JSON: []',
    'FILAZOO_CRM_READ_JSON: {"resource":"companies"}\nFILAZOO_QUESTION_JSON: {"question":"Which customer?"}',
    'FILAZOO_QUESTION_JSON: {}', 'FILAZOO_QUESTION_JSON: {"question":"x","operation":{}}',
    'FILAZOO_QUESTION_JSON: {"question":"Which customer?"}\nFILAZOO_QUESTION_JSON: {}',
    'FILAZOO_QUESTION_JSON: {"question":"FILAZOO_ACTIONS_JSON: []"}',
  ]) assert.throws(() => extractAgentQuestion(output));
});

test("bare invoice requests preserve ordinary spelling errors but exclude supplied items and order references", () => {
  for (const text of ["can create a invoice for this costmer", "can you create invioce for this customer", "Please create an invoice", "create a draft invoice for this company?"]) assert.equal(isBareInvoiceRequest(text), true, text);
  for (const text of ["Create invoice for 10 Black PLA", "Invoice this purchase order PO-10", "Create an invoice for Acme", "Which invoice is this?", "Create an invoice for 1"]) assert.equal(isBareInvoiceRequest(text), false, text);
  assert.equal(isInvoiceDetailQuestion("do you add address of the customer"), true);
  assert.equal(isInvoiceDetailQuestion("Did you include shipping on the invoice?"), true);
  assert.equal(isInvoiceDetailQuestion("Can you add the billing address to the invoice?"), false);
  assert.equal(isInvoiceDetailQuestion("Did you include the address? Also change shipping to $12."), false);
});

test("explicit black and gold grounds the actual saved variant and price rather than a model-selected red and gold", () => {
  const grounded = groundInvoiceVariant(selection, [product], { messages: [user("create an invoice"), { role: "assistant", content: "Which products?" }, user("the products are pla silk dual color black and gold 100 pas")] });
  assert.equal(grounded.items?.[0].variantId, "black-gold");
  assert.equal(grounded.items?.[0].quantity, 100);
  assert.equal(selection.items[0].variantId, "red-gold", "Do not mutate the provider response or a saved proposal");
  const document = buildAgentInvoice({ ...blankInvoiceDocument("2026-10-29"), customerName: "Audit" }, grounded, [product], []);
  assert.equal(document.items[0].variantId, "black-gold"); assert.equal(document.items[0].unitPriceMinor, 650);
});

test("unavailable or ambiguous colors ask a real catalog question and newer explicit choices override older ones", () => {
  assert.throws(() => groundInvoiceVariant(selection, [{ ...product, variants: [product.variants[0]] }], { messages: [user("100 PLA silk black and gold pieces")] }), (error: unknown) => error instanceof AgentClarificationError && /Which saved variant/.test(error.message) && /Red Gold/.test(error.message));
  assert.throws(() => groundInvoiceVariant(selection, [{ ...product, variants: [...product.variants, { ...product.variants[1], id: "black-gold-matte", name: "Matte Black Gold" }] }], { messages: [user("100 PLA black gold")] }), AgentClarificationError);
  assert.equal(groundInvoiceVariant(selection, [product], { messages: [user("100 PLA silk black gold"), user("Use red gold instead")] }).items?.[0].variantId, "red-gold");
  assert.equal(groundInvoiceVariant(selection, [product], { messages: [user("Use SKU SILK-02, 100 pieces")] }).items?.[0].variantId, "black-gold");
  assert.equal(groundInvoiceVariant(selection, [product], { messages: [user("SKU SILK-020, 100 pieces")] }).items?.[0].variantId, "red-gold", "A SKU prefix is not an exact identity");
});

test("invoice review memory includes saved addresses and line identities but omits payment secrets and unsupported actions", () => {
  const id = "a1111111-1111-4111-8111-111111111111";
  const document = { ...blankInvoiceDocument("2026-10-29"), customerName: "Audit", customerAddress: "Billing test address", shippingAddress: "Delivery test address", items: [{ description: "PLA Black Gold", quantity: 100, unitPriceMinor: 650, taxBps: 0 }], paymentInstructions: "DO NOT EXPOSE ACCOUNT", sourceThreadId: "PRIVATE THREAD", paymentMethods: [{ secret: "DO NOT EXPOSE METHOD" }] };
  const prompt = pendingInvoicePrompt([{ id, action: { type: "create_invoice", document } }, { id, action: { type: "manage_mailbox", secret: "PRIVATE CREDENTIAL" } }]);
  assert.match(prompt, /PENDING_INVOICE_PROPOSALS/); assert.match(prompt, /Billing test address/); assert.match(prompt, /Delivery test address/); assert.match(prompt, /pending approval, not saved or sent/);
  assert.doesNotMatch(prompt, /DO NOT EXPOSE|PRIVATE THREAD|PRIVATE CREDENTIAL/);
  assert.equal(pendingInvoicePrompt([]), "");
});
