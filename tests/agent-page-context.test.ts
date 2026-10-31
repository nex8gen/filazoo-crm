import { policyTestDependency } from "./helpers/ai-policy.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { assistantRecordScope, readAssistantPageContext } from "../lib/ai/page-context.ts";
import { workspaceAssistantSchema } from "../lib/ai/workspace-assistant.ts";
import * as flows from "../lib/flows.ts";

const id = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
const otherId = "15693adc-0bdf-4617-b214-71b1861764a9";
function page(attributes: Record<string, string>) {
  return { querySelector(selector: string) {
    const attribute = selector.slice(1, -1);
    return attribute in attributes ? { getAttribute: () => attributes[attribute] } : null;
  } } as unknown as ParentNode;
}

test("page context follows mailbox, conversation and flow selection with separate conversation scopes", () => {
  const email = readAssistantPageContext(page({ "data-ai-email-id": "mail-1", "data-ai-mailbox-id": id }));
  assert.equal(email.mailboxId, id);
  assert.notEqual(assistantRecordScope(email), assistantRecordScope({ ...email, mailboxId: otherId }));
  const message = readAssistantPageContext(page({ "data-ai-conversation-id": "instagram:page:customer-1" }));
  assert.equal(message.emailId, undefined);
  assert.notEqual(assistantRecordScope(message), assistantRecordScope({ conversationId: "instagram:page:customer-2" }));
  const flow = readAssistantPageContext(page({ "data-ai-flow-id": id, "data-ai-flow-draft": JSON.stringify(flows.defaultFlowInput), "data-ai-flow-unsaved": "true", "data-ai-flow-step-id": "trigger" }));
  assert.deepEqual(flow.flowDraft, flows.defaultFlowInput);
  assert.equal(flow.flowUnsaved, true);
  assert.equal(flow.flowStepId, "trigger");
  assert.notEqual(assistantRecordScope(flow), assistantRecordScope({ flowId: otherId }));
});

test("an incomplete flow editor is marked unsaved without rejecting the assistant request", () => {
  const context = readAssistantPageContext(page({ "data-ai-flow-draft": '{"name":""}', "data-ai-flow-unsaved": "true" }));
  assert.equal(context.flowDraft, undefined);
  assert.equal(context.flowUnsaved, true);
  assert.equal(workspaceAssistantSchema.safeParse({ mode: "work", pageContext: context, pathname: "/workflow", pageLabel: "Flows", pageText: "", messages: [{ role: "user", content: "Add an email step here" }] }).success, true);
});

const require = createRequire(import.meta.url);
function loadRecords(dependencies: Record<string, unknown>) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/ai/agent-page-records.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (name === "server-only" ? {} : dependencies[name] ?? require(name)), Error });
  return exports as typeof import("../lib/ai/agent-page-records.ts");
}

test("Messenger context reloads the selected channel and page and returns internal action IDs without payloads", async () => {
  const filters: unknown[] = [];
  const query = { select(fields: string) { assert.ok(!fields.includes("payload")); return query; }, eq(key: string, value: string) { filters.push([key, value]); return query; }, order() { return query; }, async limit(count: number) { assert.equal(count, 25); return { data: [{ id, direction: "inbound", body: "Please quote PLA", created_at: "2026-10-28T00:00:00Z", raw_payload: { private: true } }], error: null }; } };
  const records = loadRecords({
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: () => query }) },
    "../meta-messenger": { getMetaInboxData: async () => ({ threads: [{ id: "instagram:page:customer", pageId: "page", customerId: "customer", customer: "Buyer", channel: "instagram", replyWindowOpen: true }] }) },
    "../data/flows": { listWorkspaceFlows: async () => [{ id, ...flows.defaultFlowInput }] },
  });
  const conversation = await records.loadAgentConversation("instagram:page:customer");
  assert.equal(conversation.messages[0].id, id);
  assert.equal(conversation.messages[0].text, "Please quote PLA");
  assert.equal(JSON.stringify(conversation).includes("private"), false);
  assert.deepEqual(filters, [["thread_id", "customer"], ["page_id", "page"], ["source", "instagram_messaging"]]);
  await assert.rejects(() => records.loadAgentConversation("facebook:page:customer"), /unavailable/);
  assert.equal((await records.loadAgentFlow(id)).id, id);
  await assert.rejects(() => records.loadAgentFlow(otherId), /unavailable/);
});
