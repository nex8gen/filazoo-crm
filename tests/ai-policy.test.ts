import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as rules from "../lib/ai-policy.ts";
import * as assistant from "../lib/ai/workspace-assistant.ts";
import * as tools from "../lib/ai/crm-tools.ts";
import * as images from "../lib/ai/image-input.ts";
import * as actions from "../lib/ai/agent-actions.ts";
import { visibleSettingsSections } from "../lib/settings-sections.ts";

const userId = "a1111111-1111-4111-8111-111111111111";
const proposalId = "b2222222-2222-4222-8222-222222222222";
function load<T>(file: string, dependencies: Record<string, unknown>, extra = {}): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    if (name.replace(/\.ts$/, "") in dependencies) return dependencies[name.replace(/\.ts$/, "")];
    throw new Error(`Unexpected dependency: ${name}`);
  }, Response, Request, URL, AbortSignal, Date, Error, crypto, console, ...extra });
  return exports as T;
}
function gates(policy: rules.AiPolicy) {
  return { getAiSettings: async () => ({ policy, revision: 1, updatedAt: null }), requireAiFeature: async (feature: rules.AiFeature, ...data: rules.AiData[]) => { rules.assertAiFeature(policy, feature); rules.assertAiData(policy, ...data); return policy; } };
}
const company = { type: "create_company", company: { name: "Acme", country: "US", segment: "Reseller" } };

test("new workspace defaults require review and validate a complete policy", () => {
  const policy = rules.defaultAiPolicy();
  assert.equal(rules.aiActionApproval(policy, company, "auto"), "ask");
  assert.ok(Object.values(policy.actions).every(mode => mode === "ask"));
  assert.equal(rules.aiPolicySchema.safeParse({ ...policy, enabled: "false" }).success, false);
  assert.equal(rules.aiPolicySchema.safeParse({ ...policy, instructions: "x".repeat(4001) }).success, false);
  assert.equal(rules.aiPolicySchema.safeParse({ ...policy, data: {} }).success, false);
});

test("conversation tagging has its own permission and older saved policies default to review", () => {
  const policy = rules.defaultAiPolicy();
  const legacyActions = Object.fromEntries(Object.entries(policy.actions).filter(([key]) => key !== "tagging"));
  const parsed = rules.aiPolicySchema.parse({ ...policy, actions: legacyActions });
  assert.equal(parsed.actions.tagging, "ask");
  parsed.actions.tagging = "auto";
  assert.equal(parsed.actions.emailDrafts, "ask");
  assert.equal(parsed.actions.sending, "ask");
});
test("automatic permission still respects Ask mode and denied actions override both modes", () => {
  const policy = rules.defaultAiPolicy(); policy.actions.customers = "auto";
  assert.equal(rules.aiActionApproval(policy, company, "auto"), "auto");
  assert.equal(rules.aiActionApproval(policy, company, "ask"), "ask");
  policy.actions.customers = "deny";
  for (const mode of ["auto", "ask"] as const) assert.throws(() => rules.aiActionApproval(policy, company, mode), /blocked/);
  policy.actions.customers = "auto"; policy.data.customers = false;
  assert.throws(() => rules.aiActionApproval(policy, company, "auto"), /access to customers/);
});
test("all current tools have explicit access requirements; unknown tools fail closed", () => {
  for (const option of tools.crmOperationSchema.options) {
    const name = option.shape.op.value;
    assert.doesNotThrow(() => rules.aiActionRequirements({ type: "crm_action", operation: { op: name } }), name);
  }
  for (const name of ["create_company", "update_company", "add_company_note", "create_flow", "create_invoice", "update_invoice", "send_invoice", "write_email"]) assert.doesNotThrow(() => rules.aiActionRequirements({ type: name }));
  for (const resource of tools.crmReadSchema.shape.resource.options) assert.ok(rules.aiReadResources[resource]?.length, resource);
  assert.throws(() => rules.aiActionRequirements({ type: "new_unclassified_tool" }), /no access policy/);
});
test("combined invoice email and catalog actions require every permission", () => {
  const policy = rules.defaultAiPolicy();
  const action = { type: "create_invoice", email: { delivery: "send", attachCatalog: true } };
  for (const key of ["sending", "invoices", "catalogs"] as const) {
    const copy = structuredClone(policy); copy.actions[key] = "deny";
    assert.throws(() => rules.aiActionApproval(copy, action, "auto"), /blocked/);
  }
  policy.features.email = false;
  assert.throws(() => rules.aiActionApproval(policy, { type: "write_email", email: { delivery: "draft" } }, "auto"), /Email assistance is disabled/);
});
test("master and feature switches block requests; behavior guidance includes saved writing instructions", () => {
  const policy = rules.defaultAiPolicy();
  policy.businessContext = "Filament distributor"; policy.emailInstructions = "Use a short greeting";
  assert.match(rules.aiBehaviorInstruction(policy, true), /Filament distributor/);
  assert.match(rules.aiBehaviorInstruction(policy, true), /Use a short greeting/);
  policy.enabled = false;
  for (const feature of Object.keys(policy.features) as rules.AiFeature[]) assert.throws(() => rules.assertAiFeature(policy, feature), rules.AiPolicyError);
});

test("live flow activation cannot bypass a blocked sending permission", () => {
  const policy = rules.defaultAiPolicy(); policy.actions.flows = "auto"; policy.actions.sending = "deny";
  assert.equal(rules.aiActionApproval(policy, { type: "create_flow", flow: { status: "draft" } }, "auto"), "auto");
  for (const action of [
    { type: "create_flow", flow: { status: "live" } },
    { type: "crm_action", operation: { op: "flow_status", status: "live" } },
    { type: "crm_action", operation: { op: "update_flow", changes: { name: "Updated live flow" } } },
  ]) assert.throws(() => rules.aiActionApproval(policy, action, "auto"), /blocked/);
});

test("restricted context never loads disabled CRM resources", async () => {
  const policy = rules.defaultAiPolicy();
  for (const key of Object.keys(policy.data) as rules.AiData[]) policy.data[key] = false;
  const unexpected = () => { throw new Error("Disabled CRM data was loaded"); };
  const context = load<{ loadAgentContext: (input: unknown, viewer: unknown) => Promise<Record<string, unknown>> }>("../lib/ai/agent-context.ts", {
    "zod": { z }, "../data/ai-settings": gates(policy), "../ai-policy": rules,
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: unexpected }) },
    "../data/invoice-connections": { invoiceBootstrap: unexpected, invoiceCustomers: unexpected },
    "../data/invoice-banks": { invoiceBankAccounts: unexpected }, "../data/invoice-payment-methods": { invoicePaymentMethods: unexpected },
    "../data/invoices": { getInvoice: unexpected }, "../data/mailboxes": { getEffectiveMailbox: unexpected, mailboxHasSmtp: () => false },
    "../invoice-links": { invoiceProduct: unexpected }, "./agent-records": { loadAgentCompany: unexpected, loadAgentEmails: unexpected }, "../email-threading": {},
    "../flows": { flowAgentCapabilities: () => ({}) }, "./agent-page-records": { loadAgentConversation: unexpected, loadAgentFlow: unexpected },
    "../data/product-personalization": { userProductRows: unexpected },
  });
  const result = await context.loadAgentContext({ pathname: `/companies/${userId}`, pageContext: { companyId: userId, emailId: "message", invoiceId: userId, conversationId: "thread", flowId: userId }, completedActionIds: [proposalId], messages: [{ role: "user", content: "Check automation" }] }, { id: userId, role: "admin" });
  for (const field of ["currentCompany", "currentEmail", "currentInvoice", "currentConversation", "currentFlow", "flowEditor"]) assert.equal(result[field], null, field);
  for (const field of ["products", "customerChoices", "emailHistory", "EXECUTION_RESULTS"]) assert.equal((result[field] as unknown[]).length, 0, field);
});

type Post = { POST: (request: Request) => Promise<Response> };
function assistantFixture(policy: rules.AiPolicy) {
  const calls: string[] = [];
  let sessionCalls = 0;
  const route = load<Post>("../app/api/ai/assistant/route.ts", {
    "@/lib/data/ai-settings": gates(policy), "@/lib/ai-policy": rules,
    "@/lib/auth": { getWorkspaceViewer: async () => ({ id: userId, role: "admin" }) },
    "@/lib/ai/workspace-assistant": assistant, "@/lib/i18n": { translateUiText: (text: string) => text },
    "@/lib/ai/gemini": { generateGeminiText: async ({ prompt }: { prompt: string }) => { calls.push(prompt); return "Answer"; } },
    "@/lib/ai/gateway": {}, "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) }, "@/lib/ai/agent-execution": {},
    "@/lib/ai/assistant-provider-error": {}, "@/lib/ai/customer-research": {}, "@/lib/ai/image-input": images,
    "@/lib/ai/crm-tools": tools, "@/lib/ai/crm-records": {},
    "@/lib/ai/chat-session": { startChatSession: async () => { sessionCalls++; return undefined; } },
    "@/lib/ai/chat-history-server": { HistoryError: Error }, "@/lib/ai/chat-history": { savedPageContext: () => ({}) },
    "@/lib/ai/invoice-readiness": {},
  }, { process: { env: { GEMINI_API_KEY: "synthetic-test" } } });
  const request = (patch = {}) => new Request("http://localhost:3000/api/ai/assistant", { method: "POST", body: JSON.stringify({ mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "PRIVATE PAGE SNAPSHOT", messages: [{ role: "user", content: "Earlier private customer data" }, { role: "assistant", content: "Earlier private answer" }, { role: "user", content: "Hello" }], ...patch }) });
  return { ...route, calls, request, sessionCalls: () => sessionCalls };
}
for (const disabled of ["enabled", "chat", "webSearch"] as const) test(`assistant denies ${disabled} before provider or history access`, async () => {
  const policy = rules.defaultAiPolicy();
  if (disabled === "enabled") policy.enabled = false; else policy.features[disabled] = false;
  const fixture = assistantFixture(policy);
  const result = await fixture.POST(fixture.request(disabled === "webSearch" ? { webSearch: true } : {}));
  assert.equal(result.status, 403);
  assert.equal(fixture.calls.length, 0); assert.equal(fixture.sessionCalls(), 0);
});
test("revoked CRM access removes earlier turns and snapshots before model invocation", async () => {
  const policy = rules.defaultAiPolicy(); policy.data.customers = false;
  const fixture = assistantFixture(policy);
  assert.equal((await fixture.POST(fixture.request())).status, 200);
  assert.equal(fixture.sessionCalls(), 0);
  assert.equal(fixture.calls.length, 1);
  assert.doesNotMatch(fixture.calls[0], /PRIVATE PAGE SNAPSHOT|Earlier private/);
  assert.doesNotMatch(fixture.calls[0], /"label":"Companies"/);
  assert.match(fixture.calls[0], /Hello/);
});

test("changed policy blocks an old automatic proposal before claiming or executing it", async () => {
  const policy = rules.defaultAiPolicy(); let claims = 0, executed = 0;
  const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({ data: { id: proposalId, action: company, approval_mode: "auto", status: "pending", expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null }), update() { claims++; return chain; } };
  const route = load<Post>("../app/api/ai/assistant/action/route.ts", {
    "zod": { z }, "@/lib/data/ai-settings": gates(policy), "@/lib/ai-policy": rules,
    "@/lib/auth": { getWorkspaceViewer: async () => ({ id: userId, role: "admin" }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => chain }) },
    "@/lib/ai/agent-actions": actions, "@/lib/ai/agent-execution": { executeAgentAction: async () => { executed++; } },
  });
  const result = await route.POST(new Request("http://localhost:3000/api/ai/assistant/action", { method: "POST", body: JSON.stringify({ id: proposalId, decision: "approve", approval: "auto" }) }));
  assert.equal(result.status, 403); assert.equal(claims, 0); assert.equal(executed, 0);
});

test("settings persistence fails closed and uses compare-and-set revisions", async () => {
  let saved: { policy: rules.AiPolicy; revision: number; updated_at: string } | null = null;
  let databaseError = false;
  const data = load<{ getAiSettings: () => Promise<{ policy: rules.AiPolicy; revision: number }>; saveAiSettings: (policy: rules.AiPolicy, revision: number, user: string) => Promise<unknown>; requireAiAutomation: (actions: rules.AiAction[], data: rules.AiData[]) => Promise<unknown> }>("../lib/data/ai-settings.ts", {
    "../ai-policy": rules, "../env": { hasSupabaseConfig: () => true },
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: () => {
      let mutation: typeof saved = null, expected: number | undefined;
      let inserting = false;
      const chain = { select() { return chain; }, eq(key: string, value: number) { if (key === "revision") expected = value; return chain; },
        insert(row: NonNullable<typeof saved>) { mutation = row; inserting = true; return chain; }, update(row: NonNullable<typeof saved>) { mutation = row; return chain; },
        async maybeSingle() {
          if (databaseError) return { data: null, error: { code: "DB_DOWN" } };
          if (!mutation) return { data: saved, error: null };
          if (inserting && saved) return { data: null, error: { code: "23505" } };
          if (!inserting && saved?.revision !== expected) return { data: null, error: null };
          saved = mutation; return { data: { revision: saved.revision }, error: null };
        } };
      return chain;
    } }) },
  });
  assert.equal((await data.getAiSettings()).revision, 0);
  await data.saveAiSettings(rules.defaultAiPolicy(), 0, userId);
  await assert.rejects(data.saveAiSettings(rules.defaultAiPolicy(), 0, userId), /another session/);
  const changed = rules.defaultAiPolicy(); changed.data.emails = false;
  await data.saveAiSettings(changed, 1, userId);
  assert.equal((await data.getAiSettings()).policy.data.emails, false);
  await assert.rejects(data.saveAiSettings(rules.defaultAiPolicy(), 1, userId), /another session/);
  await assert.rejects(data.requireAiAutomation(["sending"], []), /review/);
  databaseError = true;
  await assert.rejects(data.getAiSettings(), /AI is paused/);
});

test("policy writes require an administrator and the section is discoverable to all members", async () => {
  let writes = 0;
  const route = load<{ updateAiSettings: (input: unknown) => Promise<unknown> }>("../app/settings/ai-settings-actions.ts", {
    "zod": { z }, "next/cache": { revalidatePath() {} }, "@/lib/ai-policy": rules,
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { assert.deepEqual(Array.from(roles), ["admin"]); throw new Error("Access denied"); } },
    "@/lib/data/ai-settings": { saveAiSettings: async () => { writes++; } },
  });
  await assert.rejects(route.updateAiSettings({ policy: rules.defaultAiPolicy(), revision: 0 }), /Access denied/);
  assert.equal(writes, 0);
  assert.deepEqual(visibleSettingsSections(false, "AI permissions").map(section => section.id), ["ai"]);
});
