import assert from "node:assert/strict";
import test from "node:test";
import { blankStep, flowInputSchema, defaultFlowInput } from "../lib/flows.ts";
import { calculateWaitUntil, simulateFlow, triggerMatches, type FlowFacts } from "../lib/flow-engine.ts";
import { flowReplyInstruction, resolveFlowReply, shouldAttachFlowCatalog } from "../lib/ai/flow-reply.ts";
import type { InvoiceProduct } from "../lib/invoice-links.ts";

const facts: FlowFacts = { customerReplied: true, openedEmail: false, clickedLink: false, category: null, segment: "Reseller", country: "US", companyStatus: "new", pipelineStage: "new", fitScore: 5 };
const product: InvoiceProduct = { sku: "PLA", name: "PLA Basic", imageUrl: null, currency: "USD", priceMinor: 1000, moq: 20, stockStatus: "In stock", tiers: [{ minimumQuantity: 100, priceMinor: 800 }], variants: [{ id: "black", name: "Black", sku: "PLA-BL", priceMinor: 1000, stockStatus: "In stock", imageUrl: null }] };
const output = (body: string, quotes: unknown[] = []) => JSON.stringify({ subject: "Your filament inquiry", body, quotes });

test("new lead → five minutes → AI reply accepts all segments and replies received during the wait", () => {
  const flow = flowInputSchema.parse({ ...defaultFlowInput, triggerType: "new_lead", triggerConfig: {}, steps: [
    { type: "wait", config: { amount: 5, unit: "minutes", businessDays: false, resumeAt: "" } }, blankStep("ai_auto_reply"),
  ] });
  assert.equal(triggerMatches("new_lead", {}, { type: "new_lead", conversationId: "lead" }, facts), true);
  assert.equal(triggerMatches("new_lead", { segment: "Print farm" }, { type: "new_lead", conversationId: "lead" }, facts), false);
  const result = simulateFlow(flow, facts, new Date("2026-10-23T20:00:00Z"));
  assert.equal(result.terminal, "complete");
  assert.equal(result.trace[1].type, "ai_auto_reply");
  assert.equal(result.trace[1].status, "would_run");
  assert.equal(calculateWaitUntil(flow.steps[0].config, new Date("2026-10-23T20:00:00Z")).toISOString(), "2026-10-23T20:05:00.000Z");
});

test("AI pricing needs product lookup and a sender mailbox", () => {
  for (const overrides of [{ mailboxId: "" }, { useProducts: false, usePrices: true }, { language: "xx" }]) {
    const step = blankStep("ai_auto_reply");
    assert.equal(flowInputSchema.safeParse({ ...defaultFlowInput, steps: [{ ...step, config: { ...step.config, ...overrides } }] }).success, false);
  }
});

test("unit quotes resolve currency and quantity breaks from CRM prices", () => {
  const plan = resolveFlowReply(output("For black PLA: {{price:1}}.", [{ productSku: "PLA", variantId: "black", quantity: 100 }]), [product], true);
  assert.match(plan.body, /\$8\.00 USD per unit \(100 units\)/);
  const variantProduct = { ...product, variants: [{ ...product.variants[0], priceMinor: 1200 }] };
  assert.match(resolveFlowReply(output("{{price:1}}", [{ productSku: "PLA", variantId: "black", quantity: 100 }]), [variantProduct], true).body, /\$12\.00/);
});

test("unknown products, variants, missing prices, below-MOQ quantities and disabled pricing cannot be sent", () => {
  for (const quote of [
    { productSku: "FAKE", variantId: null, quantity: 100 },
    { productSku: "PLA", variantId: "blue", quantity: 100 },
    { productSku: "PLA", variantId: null, quantity: 100 },
    { productSku: "PLA", variantId: "black", quantity: 1 },
  ]) assert.throws(() => resolveFlowReply(output("{{price:1}}", [quote]), [product], true));
  const quote = { productSku: "PLA", variantId: "black", quantity: 100 };
  assert.throws(() => resolveFlowReply(output("{{price:1}}", [quote]), [product], false));
  assert.throws(() => resolveFlowReply(output("{{price:1}}", [quote]), [{ ...product, tiers: [], priceMinor: null, variants: [{ ...product.variants[0], priceMinor: null }] }], true));
});

test("literal money and unresolved placeholders are rejected", () => {
  for (const body of ["Price is $1", "USD 1.50", "1.50 EUR", "{{price:5}}", "{{price:unknown}}"])
    assert.throws(() => resolveFlowReply(output(body), [product], true));
  assert.throws(() => resolveFlowReply(JSON.stringify({ subject: "Hi\r\nBcc: someone", body: "Hello", quotes: [] }), [], true));
  assert.equal(resolveFlowReply(output("Which material and quantity do you need?"), [], false).body, "Which material and quantity do you need?");
});

test("catalog is attached only to the first actual automated message by default", () => {
  const config = blankStep("ai_auto_reply").config;
  assert.equal(shouldAttachFlowCatalog(config, 0), true);
  assert.equal(shouldAttachFlowCatalog(config, 1), false);
  assert.equal(shouldAttachFlowCatalog({ ...config, catalogFirstMessageOnly: false }, 2), true);
  assert.equal(shouldAttachFlowCatalog({ ...config, attachCatalog: false }, 0), false);
  assert.match(flowReplyInstruction(config, false), /No catalog is attached/);
  assert.match(flowReplyInstruction(config, true), /will attach the current product catalog/);
  assert.match(flowReplyInstruction(config, false), /If there is no email/);
});
