import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as leads from "../lib/lead-inquiries.ts";
import { conversationTagKeys, applyConversationCustomerTags } from "../lib/customer-tags.ts";
import { groupEmailConversations } from "../lib/email-threading.ts";
import { conversationTagInput } from "../lib/ai/conversation-tagging.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";

const shopify: leads.ShopifyInquiryRow = { webhook_id: "lead-1", customer_id: "form:1", email: "buyer@example.test", full_name: "Buyer", company_name: "Buyer Ltd", phone: null, tags: [], raw_payload: { "contact[body]": "Please quote blue PLA" }, created_at: "2026-10-31T01:00:00Z" };
const meta: leads.MetaInquiryRow = { leadgen_id: "lead-2", email: "buyer@example.test", full_name: "Buyer", company_id: "company", field_data: [{ name: "material", values: ["PLA"] }], created_at: "2026-10-31T01:00:00Z" };

test("verified lead records have stable inquiry keys matching database defaults", () => {
  const shop = leads.buildShopifyFormInboxItems([shopify])[0], ad = leads.buildMetaLeadInboxItems([meta])[0];
  assert.ok(conversationTagKeys([shop]).includes("conversation:shopify:lead-1"));
  assert.ok(conversationTagKeys([ad]).includes("conversation:meta-lead:lead-2"));
  const states = new Map([["conversation:shopify:lead-1", { category: "New Inquiries" as const }], ["conversation:meta-lead:lead-2", { category: "New Inquiries" as const }]]);
  assert.ok(applyConversationCustomerTags([shop, ad], states).every(item => item.category === "New Inquiries"));
  assert.equal(ad.status, "Meta lead form"); assert.equal(ad.messageId, undefined);
  assert.match(ad.body, /material: PLA/);
  assert.equal(leads.buildMetaLeadInboxItems([{ ...meta, email: null }]).length, 0);
});

test("new conversation activity can advance the original form's tag without leaving a stale company tag", () => {
  for (const origin of [leads.buildShopifyFormInboxItems([shopify])[0], leads.buildMetaLeadInboxItems([meta])[0]]) {
    const sent: InboxEmailItem = { ...origin, id: "sent-1", messageId: "<sent1@seller>", direction: "outbound", status: "Sent", body: "Quote attached", timestamp: "2026-10-31T02:00:00Z" };
    const reply: InboxEmailItem = { ...origin, id: "reply", messageId: "<reply@buyer>", threadId: null, inReplyTo: sent.messageId, references: [sent.messageId!], body: "Can you improve the price?", timestamp: "2026-10-31T03:00:00Z" };
    const groups = [...groupEmailConversations([origin, sent, reply]).values()];
    assert.equal(groups.length, 1);
    const input = conversationTagInput(groups[0])!;
    assert.equal(input.messageCount, 3);
    assert.ok(input.keys.includes(`conversation:${origin.threadId}`));
    const updated = new Map(input.keys.map(key => [key, { category: "Active Negotiations" as const }]));
    assert.ok(applyConversationCustomerTags([origin, sent, reply], updated).every(message => message.category === "Active Negotiations"));
  }
});

test("form origins require an explicit matching thread and contact; company/source labels never guess the link", async () => {
  let reads = 0;
  const db = { from(table: string) { reads++; const query = { select() { return query; }, eq() { return query; }, in() { return query; }, throwOnError: async () => ({ data: table === "shopify_leads" ? [shopify] : [meta] }) }; return query; } };
  const exports = {} as typeof import("../lib/data/lead-inquiries.ts");
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/lead-inquiries.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : name === "../lead-inquiries.ts" ? leads : { createSupabaseAdmin: () => db }, Set });
  const base = leads.buildShopifyFormInboxItems([shopify])[0];
  const unlinked = { ...base, id: "ordinary-mail", threadId: "unrelated-thread", source: "mailbox" as const };
  assert.equal((await exports.withLeadInquiryOrigins([unlinked])).length, 1); assert.equal(reads, 0);
  const linked = { ...unlinked, threadId: base.threadId };
  assert.equal((await exports.withLeadInquiryOrigins([linked])).length, 2);
  assert.equal((await exports.withLeadInquiryOrigins([{ ...linked, contact: "someone-else@example.test" }])).length, 1);
});

test("optional usage callbacks record actual provider counters without changing existing response contracts", async () => {
  let geminiUsage: unknown, gatewayUsage: unknown;
  assert.equal(await generateGeminiText({ apiKey: "synthetic", systemInstruction: "test", prompt: "test", onUsage: usage => { geminiUsage = usage; },
    fetcher: async () => Response.json({ candidates: [{ content: { parts: [{ text: "done" }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 10, cachedContentTokenCount: 30 } }) }), "done");
  assert.deepEqual(geminiUsage, { inputTokens: 100, outputTokens: 30, cachedInputTokens: 30 });
  assert.equal(await generateGatewayText({ token: "synthetic", systemInstruction: "test", prompt: "test", onUsage: usage => { gatewayUsage = usage; },
    fetcher: async () => Response.json({ choices: [{ message: { content: "done" } }], usage: { prompt_tokens: 80, completion_tokens: 25, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 10 } } }) }), "done");
  assert.deepEqual(gatewayUsage, { inputTokens: 80, outputTokens: 25, cachedInputTokens: 40 });
});
