import assert from "node:assert/strict";
import test from "node:test";
import { projectCustomerTags, ruleOnlyConversation, tagHealthLabel, type CustomerTagRuleState } from "../lib/customer-tag-rules.ts";
import { automaticCustomerTagSchema, parseAutomaticCustomerTagDecision, automaticCustomerTagFingerprint } from "../lib/ai/automatic-customer-tags.ts";
import { conversationTagContext } from "../lib/ai/conversation-tagging.ts";

const state: CustomerTagRuleState = { tags: ["Contacted — waiting for customer", "Repeat Customers"],
  communication: [{ keys: ["conversation:shopify:one", "conversation:message:welcome"], status: "contacted" }], processing_status: "current", processing_reason: null };

test("current company tags retire only the replied inquiry and preserve another unanswered opportunity", () => {
  assert.deepEqual(projectCustomerTags([
    { message_key: "conversation:shopify:one", tag: "New Inquiries", source: "rule" },
    { message_key: "conversation:message:welcome", tag: "New Inquiries", source: "ai" },
    { message_key: "conversation:shopify:two", tag: "New Inquiries", source: "rule" },
    { message_key: "old-order", tag: "Orders in Fulfillment", source: "ai" },
  ], state), ["New Inquiries", "Repeat Customers", "Contacted — waiting for customer"]);
});

test("manual commercial and situation decisions survive automatic projection", () => {
  const result = projectCustomerTags([{ tag: "Orders in Fulfillment", source: "manual" }, { tag: "New Inquiries", source: "flow", message_key: "conversation:shopify:one" }], state);
  assert.ok(result.includes("Orders in Fulfillment")); assert.ok(result.includes("New Inquiries"));
});

test("only verified intake plus recorded workflow sends bypass paid semantic classification", () => {
  const input = { automaticMessageIds: new Set(["<welcome@seller>"]), messages: [
    { id: "shopify-form-1", direction: "inbound" }, { id: "sent-1", direction: "outbound", messageId: "<welcome@seller>" },
  ] };
  assert.equal(ruleOnlyConversation(input), true);
  assert.equal(ruleOnlyConversation({ ...input, messages: [...input.messages, { id: "buyer-reply", direction: "inbound" }] }), false);
  assert.equal(ruleOnlyConversation({ ...input, automaticMessageIds: new Set() }), false);
  assert.equal(ruleOnlyConversation({ ...input, messages: [] }), false);
});

function context(body: string, currentTag: string | null = "Active Negotiations") {
  return conversationTagContext([{ id: "buyer-1", messageId: "<buyer-1@example.test>", direction: "inbound", contact: "buyer@example.test", company: "Buyer", status: "Received",
    subject: "PLA inquiry", body, preview: body, bodyLoaded: true, timestamp: "2026-11-20T01:00:00Z" }], currentTag);
}
const proposal = (quote: string, patch = {}) => ({ tag: "Inactive Customers", outcome: "apply", buyerPostponedPurchasing: true, confidence: 0.95,
  reason: "The buyer explicitly postponed purchasing.", evidence: [{ messageKey: "imap-<buyer-1@example.test>", quote }], ...patch });

test("semantic postponement supports exact buyer evidence in Portuguese without English keyword rules", () => {
  const body = "Vamos adiar a compra dos filamentos ate janeiro.";
  const result = parseAutomaticCustomerTagDecision(JSON.stringify(proposal(body)), context(body));
  assert.equal(result.tag, "Inactive Customers"); assert.equal(result.outcome, "apply");
});

test("unverified payment claims cannot enter the model's automatic commercial tag vocabulary", () => {
  assert.equal(automaticCustomerTagSchema.safeParse(proposal("I paid today, please ship.", { tag: "Orders in Fulfillment" })).success, false);
  assert.equal(automaticCustomerTagSchema.safeParse(proposal("Two orders were mentioned", { tag: "Repeat Customers" })).success, false);
});

test("clear is evidence validated and differs from keep or uncertainty", () => {
  const body = "Please cancel this inquiry; we will not proceed with the purchase.";
  const result = parseAutomaticCustomerTagDecision(JSON.stringify(proposal(body, { tag: null, outcome: "clear", buyerPostponedPurchasing: false })), context(body));
  assert.equal(result.outcome, "clear"); assert.equal(result.evidence.length, 1);
  assert.throws(() => parseAutomaticCustomerTagDecision(JSON.stringify(proposal("Invented cancellation that the buyer never wrote", { tag: null, outcome: "clear" })), context(body)), /evidence/);
  assert.equal(parseAutomaticCustomerTagDecision(JSON.stringify(proposal(body, { confidence: 0.8 })), context(body)).outcome, "review");
  assert.equal(parseAutomaticCustomerTagDecision(JSON.stringify(proposal(body, { tag: null, outcome: "clear" })), context(body, "Payment Follow-up")).outcome, "keep");
});

test("pending and uncertain processing have explicit customer-facing health labels", () => {
  assert.equal(tagHealthLabel("current"), null); assert.equal(tagHealthLabel("needs_review"), "Tag needs review");
  assert.equal(tagHealthLabel("waiting_history"), "Tag needs email history");
});

test("saved input identity includes model configuration and relevant workspace guidance", () => {
  const base = automaticCustomerTagFingerprint("thread-revision", { businessContext: "Filament supplier" }, {});
  assert.equal(automaticCustomerTagFingerprint("thread-revision", { businessContext: "Filament supplier" }, {}), base);
  assert.notEqual(automaticCustomerTagFingerprint("thread-revision", { businessContext: "Different business" }, {}), base);
  assert.notEqual(automaticCustomerTagFingerprint("thread-revision", { businessContext: "Filament supplier" }, { AI_GATEWAY_TAGGING_MODEL: "google/gemini-2.5-flash-lite" }), base);
});
