import assert from "node:assert/strict";
import test from "node:test";
import { blankStep, flowInputSchema, defaultFlowInput } from "../lib/flows.ts";
import { calculateWaitUntil, simulateFlow, triggerMatches, type FlowFacts } from "../lib/flow-engine.ts";
import { flowReplyInstruction, resolveFlowReply, shouldAttachFlowCatalog, resolveFlowCatalog, flowReplyContainsChinese } from "../lib/ai/flow-reply.ts";
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

test("catalog is attached on the first email or a later customer need, never every follow-up", () => {
  const config = blankStep("ai_auto_reply").config;
  assert.equal(shouldAttachFlowCatalog(config, 0), true);
  assert.equal(shouldAttachFlowCatalog(config, 1), false);
  assert.equal(shouldAttachFlowCatalog({ ...config, catalogFirstMessageOnly: false }, 2), false);
  assert.equal(shouldAttachFlowCatalog(config, 2, true), true);
  assert.equal(shouldAttachFlowCatalog({ ...config, catalogFirstMessageOnly: false }, 0), false);
  assert.equal(shouldAttachFlowCatalog({ ...config, catalogFirstMessageOnly: false }, 2, true), true);
  assert.equal(shouldAttachFlowCatalog({ ...config, attachCatalog: false }, 2, true), false);
  assert.equal(shouldAttachFlowCatalog({ ...config, attachCatalog: false }, 0), false);
  assert.match(flowReplyInstruction(config, false), /No catalog is attached/);
  assert.match(flowReplyInstruction(config, true), /will attach the current product catalog/);
  assert.match(flowReplyInstruction(config, false), /If there is no email/);
});

test("legacy language settings and new flow defaults always produce English instructions", () => {
  assert.equal(blankStep("ai_auto_reply").config.language, "en");
  for (const language of ["en", "auto", "zh-CN"]) {
    const config = { ...blankStep("ai_auto_reply").config, language };
    const parsed = flowInputSchema.parse({ ...defaultFlowInput, steps: [{ type: "ai_auto_reply", config }] });
    assert.equal(parsed.steps[0].config.language, "en");
    assert.match(flowReplyInstruction(config, false), /Write in English/);
    assert.doesNotMatch(flowReplyInstruction(config, false), /Write in Simplified Chinese|Reply in the language/);
  }
});

test("specific catalog selections never fall back to the full range", () => {
  const config = blankStep("ai_auto_reply").config;
  const skus = ["PLA-BASIC", "PLA-SILK", "PETG", "ABS"];
  const plan = (intent: string, scope: string, productSkus: string[] = []) => JSON.stringify({ intent, scope, productSkus });
  for (const intent of ["none", "requested", "recommended"]) {
    assert.deepEqual(resolveFlowCatalog(plan(intent, "selected", ["PLA-BASIC", "PLA-SILK"]), config, 0, skus), skus.slice(0, 2));
  }
  for (const intent of ["requested", "recommended"]) {
    assert.deepEqual(resolveFlowCatalog(plan(intent, "selected", ["PLA-BASIC"]), config, 3, skus), ["PLA-BASIC"]);
    assert.deepEqual(resolveFlowCatalog(plan(intent, "all"), config, 3, skus), skus);
    assert.throws(() => resolveFlowCatalog(plan(intent, "selected", []), config, 3, skus), /unavailable/);
    assert.throws(() => resolveFlowCatalog(plan(intent, "selected", ["UNKNOWN"]), config, 3, skus), /unavailable/);
    assert.throws(() => resolveFlowCatalog(plan(intent, "all", ["PLA-BASIC"]), config, 3, skus), /conflicting/);
  }
  assert.deepEqual(resolveFlowCatalog(plan("none", "all"), config, 3, skus), []);
  assert.deepEqual(resolveFlowCatalog(plan("declined", "all"), config, 0, skus), []);
  assert.deepEqual(resolveFlowCatalog(plan("requested", "unavailable"), config, 0, skus), []);
  assert.deepEqual(resolveFlowCatalog(plan("requested", "all"), { ...config, attachCatalog: false }, 0, skus), []);
});

test("Chinese prose is detected while supplied proper names are preserved", () => {
  assert.equal(flowReplyContainsChinese({ subject: "Hello", body: "Please confirm the quantity." }, []), false);
  assert.equal(flowReplyContainsChinese({ subject: "Hello", body: "您好，请确认数量。" }, []), true);
  assert.equal(flowReplyContainsChinese({ subject: "产品目录", body: "Hello" }, []), true);
  assert.equal(flowReplyContainsChinese({ subject: "Hello", body: "Hi 李明, here is the PLA catalog." }, ["李明"]), false);
});
