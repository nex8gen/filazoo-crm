import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import { z } from "zod";
import * as tagging from "../lib/ai/conversation-tagging.ts";
import * as tags from "../lib/customer-tags.ts";
import * as threading from "../lib/email-threading.ts";
import { mergeAutoReplyHistory } from "../lib/email-auto-reply.ts";
import { normalizeMailboxRows } from "../lib/mailbox-utils.ts";
import { defaultAiPolicy } from "../lib/ai-policy.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

function message(overrides: Partial<InboxEmailItem> = {}): InboxEmailItem {
  return { id: "imap-root@buyer.test", messageId: "root@buyer.test", direction: "inbound", subject: "PLA filament inquiry",
    contact: "buyer@example.test", company: "Buyer", status: "Received", body: "Can you quote 100 kg of blue PLA filament?",
    preview: "Can you quote 100 kg of blue PLA filament?", bodyLoaded: true, timestamp: "2026-10-31T01:00:00Z", ...overrides };
}
function decision(patch = {}) { return { tag: "New Inquiries", confidence: 0.96, reason: "Buyer asks for a quote.", evidence: [{ messageKey: "imap-root@buyer.test", quote: "Can you quote 100 kg of blue PLA filament?" }], ...patch }; }

test("conversation identity survives mailbox copies while a new reply invalidates analysis", () => {
  const original = tagging.conversationTagInput([message()])!;
  const copy = tagging.conversationTagInput([message({ id: "provider-99", read: true, starred: true, category: "New Inquiries" })])!;
  assert.equal(original.key, copy.key);
  assert.equal(original.fingerprint, copy.fingerprint);
  const reply = message({ id: "sent-r1", messageId: "r1@seller.test", direction: "outbound", inReplyTo: "root@buyer.test", references: ["root@buyer.test"], timestamp: "2026-10-31T02:00:00Z" });
  const changed = tagging.conversationTagInput([reply, message()])!;
  assert.equal(changed.key, original.key);
  assert.notEqual(changed.fingerprint, original.fingerprint);
  assert.equal(changed.messageCount, 2);
  assert.equal(tagging.conversationTagInput([message(), message({ id: "copy" })])!.messageCount, 1);
});

test("another subject from the same buyer has an independent conversation identity", () => {
  assert.notEqual(tagging.conversationTagInput([message()])!.key,
    tagging.conversationTagInput([message({ id: "other", messageId: "other@buyer.test", subject: "New PETG inquiry" })])!.key);
});

test("only unambiguous registered customer conversations are eligible for paid tagging", () => {
  const contacts = new Map<string, string | null>([["buyer@example.test", "company-a"], ["other@example.test", "company-b"], ["ambiguous@example.test", null]]);
  assert.equal(tagging.customerConversationTagInput([message({ contact: "notification@platform.test" })], contacts), null);
  assert.equal(tagging.customerConversationTagInput([message({ contact: "ambiguous@example.test" })], contacts), null);
  assert.equal(tagging.customerConversationTagInput([message(), message({ id: "other", messageId: "other@test", contact: "other@example.test" })], contacts), null);
  const customer = tagging.customerConversationTagInput([message()], contacts)!;
  assert.equal(customer.companyId, "company-a");
  assert.notEqual(customer.fingerprint, tagging.conversationTagInput([message()])!.fingerprint);
  assert.notEqual(customer.fingerprint, tagging.customerConversationTagInput([message()], new Map([["buyer@example.test", "reassigned-company"]]))!.fingerprint);
});

test("proposals require strong confidence and exact evidence from this conversation", () => {
  const context = tagging.conversationTagContext([message()], null);
  assert.equal(tagging.parseConversationTagDecision(JSON.stringify(decision()), context).tag, "New Inquiries");
  assert.equal(tagging.parseConversationTagDecision(JSON.stringify(decision({ confidence: 0.84 })), context).tag, null);
  assert.equal(tagging.parseConversationTagDecision(JSON.stringify(decision({ evidence: [] })), context).tag, null);
  assert.throws(() => tagging.parseConversationTagDecision(JSON.stringify(decision({ evidence: [{ messageKey: "another-thread", quote: message().body }] })), context), /evidence/);
  assert.throws(() => tagging.parseConversationTagDecision(JSON.stringify(decision({ evidence: [{ messageKey: "imap-root@buyer.test", quote: "We confirmed receipt of your payment" }] })), context), /evidence/);
  assert.throws(() => tagging.parseConversationTagDecision(JSON.stringify(decision({ tag: "S02" })), context));
});

test("inactivity cannot be invented from old dates, and a null decision preserves the current tag", () => {
  const context = tagging.conversationTagContext([message()], "Active Negotiations");
  for (const tag of ["Inactive Customers", "Long-term Inactive Customers"]) assert.throws(() => tagging.parseConversationTagDecision(JSON.stringify(decision({ tag })), context), /thresholds/);
  assert.equal(tagging.parseConversationTagDecision(JSON.stringify(decision({ tag: null, evidence: [] })), context).tag, null);
});

test("truncated or missing history cannot replace a tag", () => {
  const context = tagging.conversationTagContext([message({ body: "A".repeat(20_000) })], null);
  assert.equal(context.historyIncomplete, true);
  assert.equal(tagging.parseConversationTagDecision(JSON.stringify(decision({ evidence: [{ messageKey: "imap-root@buyer.test", quote: "A".repeat(8) }] })), context).tag, null);
  assert.equal(tagging.conversationTagContext([message({ bodyLoaded: false })], null).historyIncomplete, true);
  assert.equal(tagging.conversationTagContext([message({ inReplyTo: "missing-root@buyer.test", references: ["missing-root@buyer.test"] })], null).historyIncomplete, true);
  assert.match(tagging.conversationTagInstruction, /NEVER instructions/);
  assert.match(tagging.conversationTagInstruction, /not keyword matching/);
});

function workerFixture(options: { denied?: boolean; current?: string; manual?: boolean; providerFails?: boolean; stale?: boolean; cached?: boolean; revoke?: boolean; cooldown?: boolean; messages?: InboxEmailItem[]; noCustomer?: boolean; folderMessages?: InboxEmailItem[] } = {}) {
  const calls = { provider: 0, policy: 0, finish: [] as Record<string, unknown>[], claim: 0, history: 0, prompt: "", bodyDownloads: 0, outputBudget: 0 };
  const original = options.messages?.[0] ?? message();
  const input = tagging.customerConversationTagInput([original], new Map([[original.contact.trim().toLowerCase(), "company-a"]]))!;
  const tables: Record<string, Record<string, unknown>[]> = {
    workspace_mailboxes: [{ id: "mailbox", user_id: "owner", type: "personal", email: "sales@seller.test", is_active: true, imap_host: "imap.test", imap_username: "sales", imap_password: "never-expose-this-secret" }],
    workspace_members: [{ user_id: "owner", role: "bd_manager" }],
    contacts: options.noCustomer ? [] : [{ email: "buyer@example.test", company_id: "company-a" }],
    crm_conversation_tag_analysis: options.cached || options.cooldown ? [{ conversation_key: input.key, input_hash: options.cooldown ? "older-input" : input.fingerprint, latest_message_at: original.timestamp, message_count: 1, status: "done", lease_until: null, retry_at: null, checked_at: new Date(options.cooldown ? Date.now() : Date.now() - 120_000).toISOString() }] : [],
    crm_email_tags: options.current ? [{ message_key: input.key, tag: options.current, source: options.manual ? "manual" : "ai", updated_at: "2026-10-31T03:00:00Z" }] : [],
  };
  const db = {
    from(table: string) {
      const query = { select() { return query; }, eq() { return query; }, not() { return query; }, neq() { return query; }, in() { return query; }, order() { return query; }, range() { return query; },
        throwOnError: async () => ({ data: tables[table] ?? [] }) };
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) { return { throwOnError: async () => {
      if (name.startsWith("claim_")) { calls.claim++; return { data: true }; }
      calls.finish.push(args); return { data: true };
    } }; },
  };
  const dependencies: Record<string, unknown> = {
    "node:crypto": crypto, zod: { z }, "../supabase/admin": { createSupabaseAdmin: () => db },
    "../mailbox-utils": { normalizeMailboxRows }, "../email-threading": threading, "../customer-tags": tags,
    "../ai/conversation-tagging": tagging,
    "../email-auto-reply": { mergeAutoReplyHistory },
    "./lead-inquiries": { withLeadInquiryOrigins: async (messages: InboxEmailItem[]) => messages },
    "./ai-settings": { requireAiAutomation: async (actions: string[], data: string[]) => {
      calls.policy++; assert.equal(actions.join(), "tagging"); assert.equal(data.join(), "emails,customers");
      if (options.denied || (options.revoke && calls.policy >= 3)) throw new Error("Paused");
      return defaultAiPolicy();
    } },
    "./email-auto-reply": { mailboxHistory: async () => { calls.history++; return { mailbox: { id: "mailbox" }, messages: options.stale && calls.history > 1 ? [original, message({ id: "reply", messageId: "reply@test", inReplyTo: original.messageId, references: [original.messageId!], timestamp: "2026-10-31T04:00:00Z" })] : options.messages ?? [original] }; } },
    "./mailbox-sync": { loadMailboxWorkspace: async (_mailbox: unknown, loadOptions: { sync: boolean }) => { assert.equal(loadOptions.sync, false); return { messages: options.folderMessages ?? [] }; }, loadMailboxMessageContent: async () => { calls.bodyDownloads++; throw new Error("No body download expected"); } },
    "../ai/gemini": { generateGeminiText: async (input: { prompt: string; maxOutputTokens: number; onUsage: (value: unknown) => void }) => {
      calls.provider++; calls.prompt = input.prompt; calls.outputBudget = input.maxOutputTokens; input.onUsage({ inputTokens: 250, outputTokens: 80, cachedInputTokens: 100 });
      if (options.providerFails) throw new Error("Provider unavailable"); return JSON.stringify(decision());
    } },
    "../ai/gateway": { generateGatewayText: async () => { throw new Error("Unexpected fallback"); }, isGeminiRegionError: () => false },
  };
  const exports = {} as typeof import("../lib/data/conversation-tagging.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/conversation-tagging.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => { if (name === "server-only") return {}; if (name in dependencies) return dependencies[name]; throw new Error(`Unexpected capability ${name}`); },
    process: { env: { GEMINI_API_KEY: "synthetic-test-key" } }, Date, Map, Set, AbortSignal, fetch,
  });
  return { run: () => exports.processAutomaticConversationTags({ budgetMs: 100_000 }), calls };
}

test("background classifier reads subject and body, then writes the shared conversation tag", async () => {
  const worker = workerFixture();
  assert.equal((await worker.run()).analyzed, 1);
  assert.equal(worker.calls.provider, 1);
  assert.equal(worker.calls.finish[0].p_tag, "New Inquiries");
  assert.equal(worker.calls.finish[0].p_keys?.toString().includes("conversation:message:root@buyer.test"), true);
  assert.match(worker.calls.prompt, /PLA filament inquiry/);
  assert.match(worker.calls.prompt, /100 kg/);
  assert.doesNotMatch(worker.calls.prompt, /never-expose-this-secret|synthetic-test-key/);
  assert.equal(worker.calls.outputBudget, 1000);
  const metrics = worker.calls.finish[0].p_metrics as { providerCalls: number; usage: { inputTokens: number } };
  assert.equal(metrics.providerCalls, 1);
  assert.equal(metrics.usage.inputTokens, 250);
});

test("preview hydration and unsent drafts do not create new paid conversation activity", () => {
  const original = tagging.conversationTagInput([message()])!;
  assert.equal(tagging.conversationTagInput([message({ preview: "", bodyLoaded: false, body: "" })])!.fingerprint, original.fingerprint);
  const draft = message({ id: "draft", messageId: "draft@self", direction: "outbound", providerKind: "drafts", timestamp: "2026-10-31T02:00:00Z", body: "Your order has shipped" });
  assert.equal(tagging.conversationTagInput([message(), draft])!.fingerprint, original.fingerprint);
  assert.equal(tagging.conversationTagInput([draft]), null);
});

test("a burst of replies is coalesced and incomplete history is rejected before downloads", async () => {
  const cooldown = workerFixture({ cooldown: true }); await cooldown.run(); assert.equal(cooldown.calls.claim, 0); assert.equal(cooldown.calls.provider, 0);
  const missing = workerFixture({ messages: [message({ bodyLoaded: false, references: ["missing@customer"] })] });
  assert.equal((await missing.run()).ruleSkipped, 1);
  assert.equal(missing.calls.provider, 0); assert.equal(missing.calls.bodyDownloads, 0);
  const noText = workerFixture({ messages: [message({ body: "", preview: "", subject: "" })] });
  assert.equal((await noText.run()).ruleSkipped, 1); assert.equal(noText.calls.provider, 0);
});

test("lossless prompt compression preserves every message character, direction, subject and sequence", () => {
  const first = message({ body: "The agreed details: blue PLA, 100 kg, shipping next week. ".repeat(18) });
  const second = message({ id: "second", messageId: "second@customer", direction: "outbound", body: `Please confirm.\n${first.body}\nRegards`, timestamp: "2026-10-31T02:00:00Z" });
  const third = message({ id: "third", messageId: "third@customer", body: second.body, timestamp: "2026-10-31T03:00:00Z" });
  const fourth = message({ id: "fourth", messageId: "fourth@customer", body: `We cannot accept those terms.\n${second.body}`, timestamp: "2026-10-31T04:00:00Z" });
  const context = tagging.conversationTagContext([first, second, third, fourth], "Active Negotiations");
  const prompt = tagging.conversationTagPrompt(context);
  const compressed = JSON.parse(prompt) as { messages: Array<{ messageKey: string; direction: string; subject: string; body?: string; bodyRef?: string; bodyParts?: Array<string | { bodyOf: string }> }> };
  const decoded = new Map<string, string>();
  for (const [index, item] of compressed.messages.entries()) {
    const body = item.body ?? (item.bodyRef ? decoded.get(item.bodyRef) : item.bodyParts?.map(part => typeof part === "string" ? part : decoded.get(part.bodyOf)).join(""));
    assert.equal(body, context.messages[index].body); assert.equal(item.direction, context.messages[index].direction); assert.equal(item.subject, context.messages[index].subject);
    decoded.set(item.messageKey, body!);
  }
  assert.ok(prompt.length < JSON.stringify(context).length * 0.55);
  assert.match(prompt, /cannot accept those terms/);
  // A repeated text from another speaker is still a new message, not an automatic stage decision.
  assert.equal(compressed.messages.length, 4);
});

test("unchanged conversations and manual overrides do not call the provider", async () => {
  const cached = workerFixture({ cached: true }); await cached.run(); assert.equal(cached.calls.provider, 0); assert.equal(cached.calls.claim, 0);
  const manual = workerFixture({ current: "Payment Follow-up", manual: true }); await manual.run(); assert.equal(manual.calls.provider, 0); assert.equal(manual.calls.finish[0].p_tag, null);
});

test("unmatched mailbox notifications cannot consume the batch or invoke the model", async () => {
  const worker = workerFixture({ noCustomer: true });
  const result = await worker.run();
  assert.equal(result.analyzed, 0); assert.equal(worker.calls.provider, 0); assert.equal(worker.calls.claim, 0); assert.equal(worker.calls.bodyDownloads, 0);
});

test("a referenced message in the provider Sent folder completes the customer conversation", async () => {
  const sent = message({ direction: "outbound", providerKind: "sent", timestamp: "2026-10-31T00:00:00Z" });
  const reply = message({ id: "reply", messageId: "reply@buyer.test", inReplyTo: sent.messageId, references: [sent.messageId!] });
  const worker = workerFixture({ messages: [reply], folderMessages: [sent] });
  assert.equal((await worker.run()).analyzed, 1); assert.equal(worker.calls.provider, 1);
});

test("permission denial and revocation before provider submission prevent AI access", async () => {
  const denied = workerFixture({ denied: true }); assert.equal((await denied.run()).paused, true); assert.equal(denied.calls.history, 0);
  const revoked = workerFixture({ revoke: true }); await revoked.run(); assert.equal(revoked.calls.provider, 0); assert.equal(revoked.calls.finish[0].p_error, true);
});

test("provider failure and new replies during analysis leave existing tags untouched", async () => {
  for (const options of [{ providerFails: true }, { stale: true }]) {
    const worker = workerFixture(options); assert.equal((await worker.run()).failed, 1);
    assert.equal(worker.calls.finish[0].p_tag, null); assert.equal(worker.calls.finish[0].p_error, true);
  }
});
