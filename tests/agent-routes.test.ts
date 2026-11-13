import { policyTestDependency } from "./helpers/ai-policy.ts";
import * as replyTools from "../lib/ai/crm-reply-tools.ts";
import * as readiness from "../lib/ai/invoice-readiness.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as assistant from "../lib/ai/workspace-assistant.ts";
import * as actions from "../lib/ai/agent-actions.ts";
import * as providerError from "../lib/ai/assistant-provider-error.ts";
import * as i18n from "../lib/i18n.ts";
import * as research from "../lib/ai/customer-research.ts";
import * as companyChat from "../lib/ai/company-chat.ts";
import * as imageInput from "../lib/ai/image-input.ts";
import * as crmTools from "../lib/ai/crm-tools.ts";
import * as assistantIntent from "../lib/ai/assistant-intent.ts";
import * as documentIntent from "../lib/ai/document-intent.ts";
import { webSearchForRequest } from "../lib/ai/research-request.ts";
import { readResearchResponse, researchStreamType, type ResearchProgress } from "../lib/ai/research-progress.ts";
import { blankInvoiceDocument } from "../lib/invoices.ts";
import { agentOrderFromInvoice } from "../lib/ai/order-actions.ts";

const require = createRequire(import.meta.url);
class TestHistoryError extends Error { status = 503; }

test("temporary workspace-session failures explicitly reject before saved turns, models or actions start", async () => {
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => { throw new Error("Temporary database connection failure"); } },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/chat-session": { startChatSession: async () => assert.fail("must not create a saved turn") },
    "@/lib/ai/gateway": { generateGatewayText: async () => assert.fail("must not call a model") },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => assert.fail("must not stage actions") },
    "@/lib/ai/agent-context": {},
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/", pageLabel: "Home", pageText: "", messages: [{ role: "user", content: "Plan a campaign" }] }));
  assert.equal(response.status, 503); assert.equal(response.headers.get("Retry-After"), "1");
  const body = await response.json();
  assert.equal(body.code, "WORKSPACE_SESSION_UNAVAILABLE"); assert.equal(body.executionStarted, false); assert.equal(body.retryable, true);
  assert.doesNotMatch(JSON.stringify(body), /Temporary database connection failure/);
});
// Run the actual route handlers with isolated auth/provider/database boundaries.
// No test signs in to the real workspace, saves an invoice, or sends an email.
function route(file: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}, method: "POST" | "GET" = "POST") {
  env = { AI_AGENT_RUNTIME: "legacy", ...env };
  dependencies = { "@/lib/ai/assistant-intent": assistantIntent, "./document-intent": documentIntent, ...dependencies };
  const exports: { POST?: (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>; GET?: (request: Request) => Promise<Response> } = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name] ?? (name === "./crm-reply-tools" ? replyTools : name === "./crm-reply-execution" ? { replyOperationTarget: () => { throw new Error("Reply workflows use their dedicated fixtures"); } } : name === "../data/customer-reply-requests" ? { listReplyRequests: async () => [] } : name === "@/lib/ai/invoice-readiness" ? readiness : undefined) ?? (name === "@/lib/ai/chat-session" ? { startChatSession: async () => undefined } : name === "@/lib/ai/chat-history-server" ? { HistoryError: TestHistoryError } : name === "@/lib/ai/chat-history" ? { savedPageContext: (value: unknown) => value ?? {} } : name === "@/lib/ai/crm-tools" ? crmTools : name === "@/lib/ai/crm-records" ? {} : name === "@/lib/i18n" ? i18n : name === "@/lib/ai/customer-research" ? research : name === "@/lib/ai/image-input" ? imageInput : require(name))), Response, Request, URL, AbortSignal, Date, Error, crypto, console, process: { env } });
  return exports[method]!;
}

const viewer = { id: "a37acc59-4a11-47db-ad1e-aa9fe5d72e74", role: "admin" };
const id = "15693adc-0bdf-4617-b214-71b1861764a9";
const company = { type: "create_company", company: { name: "Acme", country: "US", segment: "Retail" } };
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/ai/assistant/action", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
const decision = { id, decision: "approve", approval: "manual" };

test("Gateway credentials select native tools by default, with no legacy text-parser fallback", async () => {
  let native = 0, google = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: () => { throw new Error("Legacy text generation must not run"); } },
    "@/lib/ai/native-agent": { nativeGatewayModels: () => { google++; return { model: {} }; }, generateCrmPlan: async () => { native++; return { output: "Saved records checked.", actions: [] }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => [] },
  }, { AI_AGENT_RUNTIME: "sdk", AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/email", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Check the saved products." }] }));
  assert.equal(response.status, 200); assert.equal(google, 1); assert.equal(native, 1);
  assert.equal((await response.json()).output, "Saved records checked.");
});

test("Chat hands off the reported Abe invoice request without model analysis or record mutations", async () => {
  const post = dialogueRoute(async () => { throw new Error("Chat must not analyze an action request"); }, {}, async () => { throw new Error("Chat must not prepare mutations"); });
  const response = await post(request({ mode: "analyze", pathname: "/email", pageLabel: "Email", pageText: "Abe M", messages: [{ role: "user", content: "can create a invoice for abe m for pla basic 500 qty" }] }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.output, /Switch to Agent/);
  assert.deepEqual(body.actions, []);
  assert.doesNotMatch(body.output, /SERVER_DATA|APPROVAL_MODE|Analysis of current state/);
});

test("Agent repairs unmarked analysis into verified customer/product reads before preparing the Abe invoice", async () => {
  for (const approvalMode of ["ask", "auto"]) {
    for (const trailer of ["", "\nFILAZOO_ACTIONS_JSON: []"]) {
    let generated = 0, prepared = 0;
    const readResources: string[] = [];
    const invoice = { type: "create_invoice", companyId: id, items: [{ productSku: "PLA-BASIC", variantId: "black", quantity: 500 }] };
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => {
        assert.equal(prepared, 0);
        if (++generated === 1) return "Analysis of current state: SERVER_DATA is empty. Please confirm customer, price and currency." + trailer;
        assert.match(prompt, /SERVER_ACTION_CORRECTION/);
        if (generated === 2) return 'FILAZOO_CRM_READS_JSON: [{"resource":"companies","query":"Abe M"},{"resource":"products","query":"PLA Basic"}]';
        assert.match(prompt, /CRM_READ_RESULTS/);
        assert.match(prompt, /PLA-BASIC/);
        return `Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([invoice])}`;
      } },
      "@/lib/ai/crm-records": { readCrmRecords: async (_viewer: unknown, lookup: { resource: string }) => {
        readResources.push(lookup.resource);
        return { records: lookup.resource === "companies" ? [{ id, name: "Abe M" }] : [{ sku: "PLA-BASIC", name: "PLA Basic", priceMinor: 500, currency: "USD", variants: [{ id: "black", name: "Black" }] }] };
      } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async (values: unknown, _viewer: unknown, mode: string) => {
        prepared++; assert.deepEqual(JSON.parse(JSON.stringify(values)), [invoice]); assert.equal(mode, approvalMode);
        return [{ id, action: invoice, approvalMode }];
      } },
    }, { AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: "synthetic" });
    const body = await (await post(request({ mode: "work", approvalMode, pathname: "/email", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "can create a invoice for abe m for pla basic 500 qty" }] }))).json();
    assert.equal(generated, 3); assert.equal(prepared, 1);
    assert.deepEqual(readResources.sort(), ["companies", "products"]);
    assert.equal(body.actions[0].action.items[0].quantity, 500);
    assert.doesNotMatch(body.output, /SERVER_DATA|Analysis of current state|Please confirm/);
    }
  }
});

test("repeated unmarked Agent analysis stops safely after one repair without leaking internal text", async () => {
  let generated = 0;
  const post = dialogueRoute(async () => { generated++; return "Analysis of current state: SERVER_DATA={} and APPROVAL_MODE=ask"; }, {}, async () => { throw new Error("Must never prepare"); });
  const body = await (await post(request({ mode: "work", pathname: "/email", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Create invoice for Abe M, 500 PLA Basic" }] }))).json();
  assert.equal(generated, 2);
  assert.deepEqual(body.actions, []);
  assert.match(body.output, /No actions were prepared/);
  assert.doesNotMatch(body.output, /SERVER_DATA|APPROVAL_MODE|Analysis of current state/);
});

test("Gateway escalates an invalid agent response before preparing any write", async () => {
  const calls: Array<{ task: string; complex: boolean; userText: string }> = [];
  let prepared = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,

    "@/lib/ai/gateway": { generateGatewayText: async (options: { task: string; complex: boolean; userText: string }) => {
      assert.equal(prepared, 0);
      calls.push({ task: options.task, complex: options.complex, userText: options.userText });
      return calls.length === 1 ? "FILAZOO_ACTIONS_JSON: invalid" : `Review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}`;
    } },
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { AI_PROVIDER: "gateway",  AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create company Acme in the US retail segment" }] }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].task, "agent");
  assert.equal(Boolean(calls[0].complex), false);
  assert.equal(calls[1].complex, true);
  assert.equal(prepared, 1);
});

test("routing receives only the latest request while retaining earlier conversation in the model prompt", async () => {
  const post = route("../app/api/ai/assistant/route.ts", {
     "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/gateway": { generateGatewayText: async (options: { userText: string; prompt: string; complex: boolean; standard: boolean }) => {
      assert.equal(options.userText, "Find customer Acme");
      assert.match(options.prompt, /Create an invoice/);
      assert.match(options.prompt, /Find customer Acme/);
      assert.equal(options.complex, false);
      assert.equal(options.standard, false);
      return "Found Acme.\nFILAZOO_ACTIONS_JSON: []";
    } },
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => [] },
  }, { AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [
    { role: "user", content: "Create an invoice for a previous customer" },
    { role: "assistant", content: "Which products?" },
    { role: "user", content: "Find customer Acme" },
  ] }));
  assert.equal(response.status, 200);
});

test("a second valid lookup raises the minimum tier to Terra without triggering Sol or partial writes", async () => {
  const calls: Array<{ standard: boolean; complex: boolean }> = [];
  let prepared = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
     "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/gateway": { generateGatewayText: async (options: { standard: boolean; complex: boolean }) => {
      assert.equal(prepared, 0);
      calls.push({ standard: options.standard, complex: options.complex });
      return calls.length < 3 ? 'FILAZOO_CRM_READ_JSON: {"resource":"products","query":"PLA"}' : "Found products.\nFILAZOO_ACTIONS_JSON: []";
    } },
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/crm-records": { readCrmRecords: async () => ({ records: [], coverage: { included: 0 } }) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/products", pageLabel: "Products", pageText: "", messages: [{ role: "user", content: "Find PLA products" }] }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ standard: false, complex: false }, { standard: false, complex: false }, { standard: true, complex: false }]);
  assert.equal(prepared, 1);
});

function dialogueRoute(generate: (options: { prompt: string }) => Promise<string>, context: object = {}, prepare: (values: unknown, viewer: unknown, mode: string, context?: unknown) => Promise<unknown[]> = async () => []) {
  return route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => context },
    "@/lib/ai/gateway": { generateGatewayText: generate }, "@/lib/ai/agent-execution": { prepareAgentActions: prepare },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
}

test("ambiguous customer lookup stops at a distinguishing question before another model call or invoice proposal", async () => {
  let generated = 0, prepared = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async () => { generated++; return 'FILAZOO_CRM_READ_JSON: {"resource":"companies","query":"Acme"}'; } },
    "@/lib/ai/crm-records": { readCrmRecords: async () => ({ records: [{ id, name: "Acme North", city: "Boston", country: "US" }, { id: viewer.id, name: "Acme South", city: "Miami", country: "US" }], coverage: { matching: 2, included: 2 } }) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const body = await (await post(request({ mode: "work", approvalMode: "auto", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create an invoice for Acme, 100 Black PLA" }] }))).json();
  assert.equal(generated, 1); assert.equal(prepared, 0); assert.deepEqual(body.actions, []); assert.match(body.output, /Acme North \(Boston, US\)/); assert.match(body.output, /Acme South \(Miami, US\)/);
});

test("a bare invoice request asks only for missing details using the open customer and never guesses products", async () => {
  for (const approvalMode of ["ask", "auto"]) {
    const post = dialogueRoute(async () => { throw new Error("No model call should guess missing invoice lines"); }, { currentCompanyId: id, currentCompany: { fields: { name: "Open Audit Customer" } } }, async () => { throw new Error("No proposal should be stored"); });
    const response = await post(request({ mode: "work", approvalMode, pathname: `/companies/${id}`, pageLabel: "Company profile", pageText: "Purchase orders", messages: [{ role: "user", content: "can create a invoice for this costmer" }] }));
    const body = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(body.actions, []);
    assert.match(body.output, /Open Audit Customer/); assert.match(body.output, /products, colors or variants, and quantities/);
    assert.doesNotMatch(body.output, /Which customer|Basic PLA|No actions were prepared/);
    assert.equal(body.clarification.question, body.output);
  }
});

test("a bare invoice request without an open customer asks for a business identity, including Chinese UI", async () => {
  const post = dialogueRoute(async () => { throw new Error("Do not invent a customer"); });
  for (const language of ["en", "zh-CN"]) {
    const body = await (await post(request({ mode: "work", language, pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Please create an invoice" }] }))).json();
    assert.deepEqual(body.actions, []); assert.match(body.output, language === "en" ? /company name or business email/ : /公司名称或业务邮箱/);
  }
});

test("a missing-detail question is a valid agent response in either approval mode and creates no action", async () => {
  for (const approvalMode of ["ask", "auto"]) {
    const post = dialogueRoute(async () => 'FILAZOO_QUESTION_JSON: {"question":"Which of the two Acme customers should I use: Acme Boston or Acme Berlin?"}', {}, async () => { throw new Error("Questions cannot execute"); });
    const body = await (await post(request({ mode: "work", approvalMode, pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Invoice Acme for 10 Black PLA" }] }))).json();
    assert.deepEqual(body.actions, []); assert.match(body.output, /Acme Boston or Acme Berlin/); assert.doesNotMatch(body.output, /FILAZOO_/);
  }
});

test("invalid invoice actions recover into a question instead of being forced into another invalid action", async () => {
  let calls = 0;
  const post = dialogueRoute(async ({ prompt }) => {
    if (++calls === 1) return 'FILAZOO_ACTIONS_JSON: [{"type":"create_invoice","companyId":"missing","items":[]}]';
    assert.match(prompt, /ask a focused FILAZOO_QUESTION_JSON/); assert.match(prompt, /original actions keep their top-level type/);
    return 'FILAZOO_QUESTION_JSON: {"question":"Which products, variants and quantities should I include for Acme?"}';
  }, {}, async () => { throw new Error("An invalid or questioning plan must not save proposals"); });
  const body = await (await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create invoice for Acme" }] }))).json();
  assert.equal(calls, 2); assert.deepEqual(body.actions, []); assert.match(body.output, /Which products/);
});

test("a follow-up answer continues the original invoice with its customer, exact quantity and user context", async () => {
  const question = "Which products, colors and quantities should I include for Audit?";
  const values = [{ type: "create_invoice", companyId: id, items: [{ productSku: "PLA", variantId: "black", quantity: 100 }] }];
  const messages = [{ role: "user", content: "can create a invoice for this costmer" }, { role: "assistant", content: question }, { role: "user", content: "100 Black PLA pieces, draft only" }];
  let prepared = 0;
  const post = dialogueRoute(async ({ prompt }) => { assert.match(prompt, /100 Black PLA/); assert.match(prompt, /Which products/); return `Review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify(values)}`; }, { currentCompanyId: id, currentCompany: { fields: { name: "Audit" } } }, async (actions, _viewer, mode, context) => {
    prepared++; assert.equal(mode, "ask"); assert.deepEqual(JSON.parse(JSON.stringify(actions)), values);
    assert.deepEqual(JSON.parse(JSON.stringify(context)), { messages }); return [{ id, action: values[0], approvalMode: "ask" }];
  });
  const body = await (await post(request({ mode: "work", pathname: `/companies/${id}`, pageLabel: "Company profile", pageText: "", messages }))).json();
  assert.equal(prepared, 1); assert.equal(body.actions.length, 1);
});

test("invoice-detail questions cannot produce duplicate invoices even if the model repeats the old creation", async () => {
  let calls = 0, prepared = 0;
  const post = dialogueRoute(async ({ prompt }) => { calls++; if (calls === 2) assert.match(prompt, /without creating or changing anything/); return `FILAZOO_ACTIONS_JSON: ${JSON.stringify([{ type: "create_invoice", companyId: id, items: [{ productSku: "PLA", quantity: 100 }] }])}`; }, {}, async () => { prepared++; return []; });
  const body = await (await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "do you add address of the customer" }] }))).json();
  assert.equal(calls, 2); assert.equal(prepared, 0); assert.deepEqual(body.actions, []); assert.match(body.output, /Which part/);
});

test("catalog business validation returns a focused question and no proposal", async () => {
  const post = dialogueRoute(async () => `FILAZOO_ACTIONS_JSON: ${JSON.stringify([{ type: "create_invoice", companyId: id, items: [{ productSku: "PLA", quantity: 100 }] }])}`, {}, async () => { throw new actions.AgentClarificationError("Which saved color should I use: Black or White?"); });
  const body = await (await post(request({ mode: "work", approvalMode: "auto", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "100 PLA pieces for Acme" }] }))).json();
  assert.deepEqual(body.actions, []); assert.equal(body.clarification.question, body.output); assert.match(body.output, /Black or White/);
});

test("malformed compound actions are replanned once before storing any proposal", async () => {
  let generated = 0, preparations = 0;
  const operations = [
    { type: "crm_action", operation: { op: "update_task", taskId: id, changes: { status: "cancelled", dueAt: null } } },
    { type: "crm_action", operation: { op: "add_business_fact", title: "Preview", content: "Synthetic approval test only." } },
  ];
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => {
      generated++;
      assert.equal(preparations, 0);
      if (generated === 1) return 'FILAZOO_ACTIONS_JSON: [{"type":"crm_action","operation":{"op":"update_task","taskId":"invalid","changes":{"status":"canceled"}}}]';
      assert.match(prompt, /SERVER_ACTION_CORRECTION/); assert.match(prompt, /operation/);
      return `Review each change.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify(operations)}`;
    } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (values: unknown) => { preparations++; assert.deepEqual(JSON.parse(JSON.stringify(values)), operations); return operations.map((action) => ({ id, action, approvalMode: "ask" })); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/tasks", pageLabel: "Tasks", pageText: "", messages: [{ role: "user", content: "Cancel my test task and preview a business fact." }] }));
  assert.equal((await response.json()).actions.length, 2); assert.equal(generated, 2); assert.equal(preparations, 1);
});

test("persistent invalid actions stop after one repair and Chat never retries them", async () => {
  for (const mode of ["work", "analyze"]) {
    let calls = 0, prepared = 0;
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/gateway": { generateGatewayText: async () => { calls++; return 'FILAZOO_ACTIONS_JSON: [{"type":"crm_action","operation":{"op":"invent_a_tool"}}]'; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
    }, { AI_GATEWAY_API_KEY: "synthetic" });
    const body = await (await post(request({ mode, pathname: "/tasks", pageLabel: "Tasks", pageText: "", messages: [{ role: "user", content: "Check my task" }] }))).json();
    assert.deepEqual(body.actions, []); assert.doesNotMatch(body.output, /FILAZOO_|invent_a_tool/);
    assert.equal(calls, mode === "work" ? 2 : 1); assert.equal(prepared, 0);
  }
});

test("read-protocol and action-protocol failures share a single repair allowance", async () => {
  let calls = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async () => ++calls === 1 ? 'FILAZOO_CRM_READ_JSON: {}\nFILAZOO_ACTIONS_JSON: []' : 'FILAZOO_ACTIONS_JSON: [bad JSON]' },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Must never prepare"); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const body = await (await post(request({ mode: "work", pathname: "/tasks", pageLabel: "Tasks", pageText: "", messages: [{ role: "user", content: "Cancel my test task" }] }))).json();
  assert.deepEqual(body.actions, []); assert.equal(calls, 2);
});

test("the assistant never returns raw email JSON and only prepares actions from a valid protocol", async () => {
  const email = { to: "buyer@example.com", subject: "Catalog", text: "The catalog is attached.", delivery: "draft", attachCatalog: true };
  const action = { type: "write_email", email };
  for (const mode of ["work", "analyze"]) {
    for (const valid of [true, false]) {
      let prepared = 0;
      const post = route("../app/api/ai/assistant/route.ts", {
        "@/lib/auth": { getWorkspaceViewer: async () => viewer },
        "@/lib/ai/workspace-assistant": assistant,
        "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
        "@/lib/ai/gateway": { generateGatewayText: async () => `\`\`\`json\n${JSON.stringify(email)}\n\`\`\`${valid ? `\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([action])}` : ""}` },
         "@/lib/ai/assistant-provider-error": providerError,
        "@/lib/ai/agent-execution": { prepareAgentActions: async (values: assistant.WorkspaceAction[]) => { prepared += values.length; return []; } },
      }, { AI_GATEWAY_API_KEY: "synthetic" });
      const response = await post(request({ mode, pathname: "/email", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Write an email and attach the catalog PDF" }] }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.doesNotMatch(body.output, /```|FILAZOO_|buyer@example|"to"|"text"/);
      assert.equal(prepared, mode === "work" && valid ? 1 : 0);
    }
  }
});

test("Chat and Agent reload the open email and bind reply proposals to its selected mailbox", async () => {
  for (const mode of ["analyze", "work"]) {
    let loads = 0;
    let preparations = 0;
    const action = { type: "write_email", email: { to: "buyer@example.com", subject: "Re: PLA", text: "Which colors do you need?", delivery: "draft", sourceEmailId: "selected-email", mailboxId: viewer.id } };
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/agent-context": { loadAgentContext: async (input: assistant.WorkspaceAssistantInput) => { loads++; assert.equal(input.pageContext?.mailboxId, id); return { currentEmail: { id: "selected-email", mailboxId: id, text: "I need 500 kg PLA" } }; } },
      "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => { assert.match(prompt, /I need 500 kg PLA/); return `Reply ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([action])}`; } },
       "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/agent-execution": { prepareAgentActions: async (values: assistant.WorkspaceAction[]) => { preparations++; assert.equal(values[0].type, "write_email"); if (values[0].type === "write_email") assert.equal(values[0].email.mailboxId, id); return []; } },
    }, { AI_GATEWAY_API_KEY: "synthetic" });
    const response = await post(request({ mode, pathname: "/email", pageLabel: "Email", pageText: "", pageContext: { emailId: "selected-email", mailboxId: id }, messages: [{ role: "user", content: "Write a reply to this" }] }));
    assert.equal(response.status, 200);
    assert.equal(loads, 1);
    assert.equal(preparations, mode === "work" ? 1 : 0);
  }
});

test("image prompts reach workspace providers in Chat and Agent mode without bypassing action approval", async () => {
  const image = { name: "address.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=" };
  for (const mode of ["analyze", "work"]) {
    let prepared = 0;
    let gatewayCalls = 0;
    let signedIn = true;
    const proposal = { type: "update_company", companyId: id, changes: { commerce: { shippingAddress: "42 Test Road" } } };
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => signedIn ? viewer : null },
      "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/assistant-provider-error": providerError,

      "@/lib/ai/gateway": { generateGatewayText: async ({ images, visionModel }: { images: imageInput.ProviderImage[]; visionModel: string }) => {
        gatewayCalls++;
        assert.equal(images[0].dataUrl, image.dataUrl);
        assert.equal(visionModel, "test-vision-model");
        return `Address read from the image.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposal])}`;
      } },
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/agent-execution": { prepareAgentActions: async (actions: unknown, _viewer: unknown, approvalMode: string) => {
        prepared++;
        assert.equal(approvalMode, "ask");
        assert.equal(JSON.stringify(actions), JSON.stringify([proposal]));
        return [{ id: "pending-approval" }];
      } },
    }, {  AI_GATEWAY_API_KEY: "test", AI_GATEWAY_VISION_MODEL: "test-vision-model" });
    const body = { mode, pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Update this customer's shipping address from the image.", images: [image] }] };
    const response = await post(request(body));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.output, mode === "work" ? "The requested actions are ready." : "Address read from the image.");
    assert.equal(prepared, mode === "work" ? 1 : 0);
    assert.equal(result.actions.length, mode === "work" ? 1 : 0);
    assert.equal((await post(request({ ...body, messages: [{ ...body.messages[0], images: [{ ...image, dataUrl: "https://attacker.example/image.png" }] }] }))).status, 400);
    assert.equal(gatewayCalls, 1);
    signedIn = false;
    assert.equal((await post(request(body))).status, 401);
    assert.equal(gatewayCalls, 1);
  }
});

test("customer image questions use authorized records and retain image context in follow-ups", async () => {
  const image = { name: "address.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=" };
  let loaded = false;
  const post = route("../app/api/companies/[id]/chat/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/data/crm": { getCompanyDetails: async (companyId: string) => { assert.equal(companyId, id); loaded = true; return { details: { company: {} } }; } },
    "@/lib/ai/company-chat": { ...companyChat, buildCompanyChatContext: () => ({ context: { coverage: {} }, sources: [] }) },
    "@/lib/ai/gateway": { generateGatewayText: async ({ images, prompt }: { images: imageInput.ProviderImage[]; prompt: string }) => {
      assert.equal(loaded, true);
      assert.deepEqual(images, [{ ...image, label: "Message 1, image 1" }]);
      assert.match(prompt, /What is the postal code/);
      assert.ok(!prompt.includes("base64"));
      return "The image shows postal code 12345.";
    } },

  }, { AI_GATEWAY_API_KEY: "test" });
  const response = await post(request({ messages: [
    { role: "user", content: "Read this image.", images: [image] },
    { role: "assistant", content: "It shows an address." },
    { role: "user", content: "What is the postal code?" },
  ] }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.match((await response.json()).output, /12345/);
});

test("agent reads email results before preparing customer updates and discards premature actions", async () => {
  const proposed = { type: "update_company", companyId: id, sourceEmailId: "mail-1", changes: { commerce: { shippingAddress: "99 New Road" } } };
  let generated = 0;
  let reads = 0;
  let stored: unknown;
  const prompts: string[] = [];
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); generated++; return generated === 1 ? `FILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}\nFILAZOO_EMAIL_SEARCH_JSON: {"companyId":"${id}"}` : `Shipping address ready for review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposed])}`; } },

    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}), searchAgentEmails: async (_viewer: unknown, search: { companyId: string }) => { reads++; assert.equal(search.companyId, id); assert.equal(stored, undefined); return { messages: [{ id: "mail-1", text: "Ship to 99 New Road" }] }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (actions: unknown, _viewer: unknown, mode: string) => { stored = actions; assert.equal(mode, "auto"); return []; } },
  }, { AI_GATEWAY_API_KEY: "test-key" });
  const response = await post(request({ mode: "work", approvalMode: "auto", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Check the emails and add the shipping address to the profile" }] }));
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
  assert.equal(generated, 2);
  assert.equal(JSON.stringify(stored), JSON.stringify([proposed]));
  assert.match(prompts[1], /EMAIL_SEARCH_RESULTS/);
  assert.match(prompts[1], /Ship to 99 New Road/);
  assert.ok(!(await response.json()).output.includes("FILAZOO_"));
});

test("email lookup failures, invalid requests and repeated reads never save partial proposals", async () => {
  for (const scenario of ["failure", "invalid", "limit", "analyze"]) {
    let reads = 0;
    let prepares = 0;
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/gateway": { generateGatewayText: async () => `FILAZOO_EMAIL_SEARCH_JSON: ${scenario === "invalid" ? '{"companyId":"forged"}' : '{}'} ` },

      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}), searchAgentEmails: async () => { reads++; if (scenario === "failure") throw new Error("Private mailbox detail"); return { messages: [] }; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepares++; return []; } },
    }, { AI_GATEWAY_API_KEY: "test-key" });
    const response = await post(request({ mode: scenario === "analyze" ? "analyze" : "work", pathname: "/email", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Check emails" }] }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.actions, []);
    assert.equal(prepares, 0);
    assert.equal(reads, scenario === "limit" || scenario === "analyze" ? 2 : scenario === "failure" ? 1 : 0);
    assert.ok(!body.output.includes("FILAZOO_"));
    assert.ok(!body.output.includes("Private mailbox detail"));
  }
});

test("CRM lookups feed verified IDs back to planning before new actions enter approval", async () => {
  let generated = 0;
  let prepared = 0;
  let read = 0;
  const proposal = { type: "crm_action", operation: { op: "schedule_followup", companyId: id, dueAt: "2026-10-28T09:00:00+08:00" } };
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => {
      generated++;
      if (generated === 1) return 'FILAZOO_CRM_READ_JSON: {"resource":"companies","query":"Acme"}';
      assert.match(prompt, /CRM_READ_RESULTS/); assert.match(prompt, /Verified Acme/);
      return `Ready for review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposal])}`;
    } },  "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/crm-records": { readCrmRecords: async (actor: { id: string }, lookup: crmTools.CrmRead) => { read++; assert.equal(actor.id, viewer.id); assert.equal(lookup.resource, "companies"); assert.equal(prepared, 0); return { records: [{ id, name: "Verified Acme" }], coverage: { included: 1 } }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (actions: unknown) => { prepared++; assert.equal(JSON.stringify(actions), JSON.stringify([proposal])); return []; } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Schedule Acme follow-up tomorrow at 9am" }] }));
  assert.equal(response.status, 200); assert.equal(read, 1); assert.equal(prepared, 1); assert.equal(generated, 2);
  assert.ok(!(await response.json()).output.includes("FILAZOO_"));
});

test("agent repairs a mixed lookup/action response once before reading and never saves premature actions", async () => {
  for (const repeats of [false, true]) {
    let generated = 0, reads = 0, prepared = 0;
    const proposal = { type: "add_company_note", companyId: id, note: "Synthetic audit" };
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => {
        generated++;
        if (generated === 1 || repeats) return `FILAZOO_CRM_READ_JSON: {"resource":"companies","query":"Audit"}\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposal])}`;
        assert.match(prompt, /SERVER_PROTOCOL_CORRECTION/);
        if (generated === 2) return 'FILAZOO_CRM_READ_JSON: {"resource":"companies","query":"Audit"}';
        assert.match(prompt, /Verified audit company/);
        return `Ready for review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposal])}`;
      } },
      "@/lib/ai/crm-records": { readCrmRecords: async () => { reads++; assert.equal(prepared, 0); return { records: [{ id, name: "Verified audit company" }] }; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; assert.equal(reads, 1); return []; } },
    }, { AI_GATEWAY_API_KEY: "synthetic" });
    const response = await post(request({ mode: "work", approvalMode: "auto", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Add the audit note to Audit company" }] }));
    assert.equal(response.status, 200);
    assert.equal(generated, repeats ? 2 : 3); assert.equal(reads, repeats ? 0 : 1); assert.equal(prepared, repeats ? 0 : 1);
    assert.ok(!(await response.json()).output.includes("FILAZOO_"));
  }
});

test("a prepared proposal never repeats the model's premature success claim", async () => {
  let executed = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async () => `The company has been created and saved.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}` },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => [{ id, approvalMode: "ask", action: company }], executeAgentAction: async () => { executed++; } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create Acme" }] }));
  const body = await response.json();
  assert.equal(body.output, "The requested actions are ready for review.");
  assert.equal(body.actions.length, 1); assert.equal(executed, 0);
});

test("independent CRM lookups start together and need only one additional model round", { timeout: 2000 }, async () => {
  let generated = 0, started = 0, finished = 0, prepared = 0;
  const pending: Array<() => void> = [];
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => {
      generated++;
      if (generated === 1) return 'FILAZOO_CRM_READS_JSON: [{"resource":"tasks"},{"resource":"inventory","id":"PLA-BLACK"}]';
      assert.equal(finished, 2); assert.match(prompt, /Verified task/); assert.match(prompt, /ERP-BLACK/); assert.match(prompt, /2 record lookups remain/);
      return `Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}`;
    } },
    "@/lib/ai/crm-records": { readCrmRecords: async (_actor: unknown, lookup: crmTools.CrmRead) => {
      started++;
      await new Promise<void>((resolve) => { pending.push(resolve); if (started === 2) pending.forEach((release) => release()); });
      finished++;
      return { records: [lookup.resource === "tasks" ? { id, title: "Verified task" } : { sku: "ERP-BLACK" }] };
    } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { assert.equal(finished, 2); prepared++; return []; } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  assert.equal((await post(request({ mode: "work", pathname: "/tasks", pageLabel: "Tasks", pageText: "", messages: [{ role: "user", content: "Check my task and PLA stock, then create Acme" }] }))).status, 200);
  assert.equal(generated, 2); assert.equal(prepared, 1);
});

test("batch failures, budget exhaustion and Chat never prepare partial actions", async () => {
  for (const scenario of ["failure", "budget", "analyze"]) {
    let generated = 0, reads = 0, prepared = 0;
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/gateway": { generateGatewayText: async () => { generated++; return `FILAZOO_CRM_READS_JSON: ${JSON.stringify(generated === 1 ? [{ resource: "tasks" }, { resource: "inventory" }, { resource: "segments" }] : [{ resource: "products" }, { resource: "companies" }])}`; } },
      "@/lib/ai/crm-records": { readCrmRecords: async (_actor: unknown, lookup: crmTools.CrmRead) => { reads++; if (scenario === "failure" && lookup.resource === "tasks") throw new Error("Private database detail"); return { records: [] }; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
    }, { AI_GATEWAY_API_KEY: "synthetic" });
    const response = await post(request({ mode: scenario === "analyze" ? "analyze" : "work", pathname: "/tasks", pageLabel: "Tasks", pageText: "", messages: [{ role: "user", content: "Check tasks, inventory and segments" }] }));
    const body = await response.json();
    assert.equal(prepared, 0); assert.equal(reads, 3); assert.deepEqual(body.actions, []);
    assert.doesNotMatch(body.output, /Private|FILAZOO_/);
  }
});

test("a provider failure after a successful lookup remains a provider error", async () => {
  let generated = 0, reads = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async () => { if (++generated === 1) return 'FILAZOO_CRM_READ_JSON: {"resource":"tasks"}'; throw new Error("AI provider is temporarily unavailable"); } },
    "@/lib/ai/crm-records": { readCrmRecords: async () => { reads++; return { records: [] }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Must not prepare"); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/tasks", pageLabel: "Tasks", pageText: "", messages: [{ role: "user", content: "Find my task" }] }));
  assert.equal(response.status, 502); assert.equal(reads, 1);
  assert.doesNotMatch((await response.json()).error, /Unable to read the requested CRM/);
});

test("CRM read failures and read budgets never create partial mutations in Chat or Agent", async () => {
  for (const scenario of ["failure", "budget", "analyze"]) {
    let reads = 0;
    let preparations = 0;
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/gateway": { generateGatewayText: async () => 'FILAZOO_CRM_READ_JSON: {"resource":"products"}' },
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/crm-records": { readCrmRecords: async () => { reads++; if (scenario === "failure") throw new Error("Private connection error"); return { records: [] }; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { preparations++; return []; } },
    }, { AI_GATEWAY_API_KEY: "synthetic" });
    const response = await post(request({ mode: scenario === "analyze" ? "analyze" : "work", pathname: "/products", pageLabel: "Products", pageText: "", messages: [{ role: "user", content: "Find PLA" }] }));
    const body = await response.json();
    assert.deepEqual(body.actions, []); assert.equal(preparations, 0); assert.equal(reads, scenario === "failure" ? 1 : 4);
    assert.ok(!body.output.includes("Private connection error")); assert.ok(!body.output.includes("FILAZOO_"));
  }
});

function actionRoute(options: { mode?: string; role?: string; owner?: string; expired?: boolean; fail?: boolean; failOnce?: boolean } = {}) {
  const row = { id, user_id: options.owner || viewer.id, action: company, approval_mode: options.mode || "ask", status: "pending", expires_at: new Date(Date.now() + (options.expired ? -1000 : 60000)).toISOString(), result: null as Record<string, unknown> | null };
  let executions = 0;
  const db = { from() {
    let mutation: Record<string, unknown> | undefined;
    const filters = new Map<string, unknown>();
    const execute = () => {
      if ([...filters].some(([key, value]) => row[key as keyof typeof row] !== value)) return { data: null, error: null };
      if (mutation) Object.assign(row, mutation);
      return { data: { ...row }, error: null };
    };
    const query = {
      select() { return query; }, update(value: Record<string, unknown>) { mutation = value; return query; },
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      async maybeSingle() { return execute(); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); },
    };
    return query;
  } };
  const dependencies = {
    "@/lib/auth": { getWorkspaceViewer: async () => ({ ...viewer, role: options.role || viewer.role }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/ai/agent-actions": actions,
    "@/lib/ai/agent-execution": { executeAgentAction: async () => {
      executions++;
      if (options.failOnce && executions === 1) { row.result = { stage: "order_saved", canResume: true, orderId: id }; throw new Error("Temporary invoice read interruption"); }
      if (options.fail) { row.result = { href: "/invoices/saved", invoiceId: "saved" }; throw new Error("Invoice saved, but mailbox failed."); }
      return { success: "Acme was added." };
    } },
  };
  const post = route("../app/api/ai/assistant/action/route.ts", dependencies);
  const get = route("../app/api/ai/assistant/action/route.ts", dependencies, {}, "GET");
  return { post, get, row, executions: () => executions };
}

test("live progress reads only the current user's action and never returns invoice or bank contents", async () => {
  const mock = actionRoute();
  mock.row.status = "running";
  mock.row.result = { progress: { area: "email", label: "Sending invoice email…", detail: "INV-000001 · buyer@example.com" }, privateBankDetails: "not-for-progress" };
  const response = await mock.get(new Request(`http://localhost:3000/api/ai/assistant/action?id=${id}`));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "running");
  assert.equal(result.progress.area, "email");
  assert.equal(result.progress.label, "Sending invoice email…");
  assert.equal(result.privateBankDetails, undefined);
  assert.equal(mock.executions(), 0);
  assert.equal((await actionRoute({ owner: "another-user" }).get(new Request(`http://localhost:3000/api/ai/assistant/action?id=${id}`))).status, 404);
  assert.equal((await mock.get(new Request("http://localhost:3000/api/ai/assistant/action?id=invalid"))).status, 400);
});

test("action status recovers completed results, partial failures and expiration without executing writes", async () => {
  const mock = actionRoute();
  mock.row.status = "completed";
  mock.row.result = { success: "Draft prepared.", href: "/email?agentDraft=saved", draft: { to: "buyer@example.com" }, privateBankDetails: "internal-only" };
  const url = new Request(`http://localhost:3000/api/ai/assistant/action?id=${id}`);
  const completed = await (await mock.get(url)).json();
  assert.equal(completed.success, "Draft prepared.");
  assert.equal(completed.draft.to, "buyer@example.com");
  assert.equal(completed.privateBankDetails, undefined);
  mock.row.status = "failed";
  mock.row.result = { success: "Invoice saved.", error: "Email not confirmed.", href: "/invoices/saved" };
  const partial = await (await mock.get(url)).json();
  assert.equal(partial.success, "Invoice saved."); assert.equal(partial.href, "/invoices/saved");
  mock.row.status = "pending"; mock.row.expires_at = "2020-01-01T00:00:00Z";
  assert.equal((await (await mock.get(url)).json()).status, "expired");
  assert.equal(mock.executions(), 0);
});

test("only a manually requested, checkpointed pre-send workflow can resume", async () => {
  const document = { ...blankInvoiceDocument("2026-11-07"), companyId: viewer.id, customerName: "Synthetic", customerEmail: "buyer@example.com", items: [{ description: "Custom part", quantity: 1, unitPriceMinor: 500, taxBps: 0 }] };
  for (const [stage, approval, expected] of [["order_saved", "manual", 200], ["sending", "manual", 409], ["order_saved", "auto", 409]] as const) {
    const mock = actionRoute();
    Object.assign(mock.row, { action: { type: "create_invoice", document, order: agentOrderFromInvoice(document).order }, status: "failed", result: { stage, canResume: true, orderId: id } });
    const response = await mock.post(request({ id, decision: "resume", approval }));
    assert.equal(response.status, expected);
    assert.equal(mock.executions(), expected === 200 ? 1 : 0);
    if (expected === 200) {
      await mock.post(request({ id, decision: "resume", approval }));
      assert.equal(mock.executions(), 1);
    }
  }
});

test("a temporary pre-send workflow interruption continues automatically under its original approval", async () => {
  const document = { ...blankInvoiceDocument("2026-11-07"), companyId: viewer.id, customerName: "Synthetic", items: [{ description: "Part", quantity: 1, unitPriceMinor: 500, taxBps: 0 }] };
  const mock = actionRoute({ failOnce: true });
  Object.assign(mock.row, { action: { type: "create_invoice", document, order: agentOrderFromInvoice(document).order } });
  const response = await mock.post(request(decision));
  assert.equal(response.status, 200); assert.equal(mock.executions(), 2);
  assert.equal((await response.json()).status, "completed");
});

test("Chat can look up an explicitly named customer's invoices from Analytics without mutations", async () => {
  let generated = 0, reads = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/gateway": { generateGatewayText: async ({ systemInstruction, prompt }: { systemInstruction: string; prompt: string }) => {
      assert.match(systemInstruction, /look up authorized CRM records from any page/);
      if (++generated === 1) return 'FILAZOO_CRM_READ_JSON: {"resource":"companies","query":"Inovecell"}';
      if (generated === 2) { assert.match(prompt, /Inovecell/); return `FILAZOO_CRM_READ_JSON: {"resource":"invoices","companyId":"${id}"}`; }
      assert.match(prompt, /INV-VERIFIED/); return "Inovecell has saved invoice INV-VERIFIED.";
    } },
    "@/lib/ai/crm-records": { readCrmRecords: async (_actor: unknown, lookup: crmTools.CrmRead) => { reads++; return { records: lookup.resource === "companies" ? [{ id, name: "Inovecell" }] : [{ id: "invoice", number: "INV-VERIFIED", company_id: id }] }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Chat cannot stage writes"); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "analyze", pathname: "/analytics", pageLabel: "Analytics", pageText: "Aggregate metrics", messages: [{ role: "user", content: "Which invoices does Inovecell have?" }] }));
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(reads, 2); assert.equal(generated, 3);
  assert.match(body.output, /INV-VERIFIED/); assert.deepEqual(body.actions, []);
});

test("an explicit other customer bypasses the open customer's missing-address shortcut and email evidence", async () => {
  let generated = 0;
  let prepared = 0;
  let addressQuestion = true;
  const otherId = viewer.id;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({ currentCompanyId: id, currentCompany: { fields: { name: "Page Customer" } }, customerChoices: [{ id, name: "Page Customer" }, { id: otherId, name: "Inovecell" }], currentEmail: { id: "page-email", direction: "inbound", text: "Old customer's price" } }) },
    "@/lib/ai/gateway": { generateGatewayText: async ({ prompt }: { prompt: string }) => { generated++; assert.match(prompt, /"usePageCompany":false/); return addressQuestion ? 'FILAZOO_QUESTION_JSON: {"question":"Which shipping address should I use for Inovecell?"}' : `Ready.\nFILAZOO_ACTIONS_JSON: [{"type":"update_company","companyId":"${otherId}","changes":{"city":"Berlin"}}]`; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (_actions: unknown, _viewer: unknown, _mode: unknown, context: { quotationSource?: unknown }) => { prepared++; assert.equal(context.quotationSource, undefined); return []; } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: `/companies/${id}`, pageLabel: "Company profile", pageText: "Page Customer", messages: [{ role: "user", content: "Include shipping address for Inovecell" }] }));
  assert.equal(response.status, 200); assert.equal(generated, 1);
  assert.match((await response.json()).clarification.question, /Inovecell/); assert.equal(prepared, 0);
  addressQuestion = false;
  const update = await post(request({ mode: "work", pathname: `/companies/${id}`, pageLabel: "Company profile", pageText: "Page Customer", messages: [{ role: "user", content: "Change Inovecell's city to Berlin" }] }));
  assert.equal(update.status, 200); assert.equal(generated, 2); assert.equal(prepared, 1);
});

test("ordinary page and general-knowledge answers do not trigger extra Chat lookups", async () => {
  for (const content of ["Summarize this page", "What is 2 + 2?"]) {
    let generated = 0;
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/agent-context": {},
      "@/lib/ai/gateway": { generateGatewayText: async ({ systemInstruction, prompt }: { systemInstruction: string; prompt: string }) => { generated++; assert.match(systemInstruction, /explicit general-knowledge question/i); assert.match(prompt, /Revenue 100/); return content.startsWith("What") ? "4" : "The page shows revenue of 100."; } },
      "@/lib/ai/agent-execution": {}, "@/lib/ai/crm-records": { readCrmRecords: async () => { throw new Error("No lookup was needed"); } },
    }, { AI_GATEWAY_API_KEY: "synthetic" });
    const response = await post(request({ mode: "analyze", pathname: "/analytics", pageLabel: "Analytics", pageText: "Revenue 100", messages: [{ role: "user", content }] }));
    assert.equal(response.status, 200); assert.equal(generated, 1); assert.deepEqual((await response.json()).actions, []);
  }
});

test("workspace web research uses selected server identity, returns source links, and remains read-only", async () => {
  let searches = 0;
  let loads = 0;
  let prompt = "";
  const report = { status: "complete", checkedAt: new Date().toISOString(), findings: "Public evidence", sources: [{ id: "W1", label: "Official site", url: "https://example.com" }], queries: [] };
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async (options: { prompt: string }) => { prompt = options.prompt; return `Company report [W1].\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}`; } },

    "@/lib/ai/agent-context": { loadAgentContext: async () => { loads++; return { currentCompany: { fields: { name: "Selected Customer", website: "example.com", contactEmail: "buyer@example.com", summary: "private-note" } } }; } },
    "@/lib/ai/customer-research": { researchCustomer: async (options: { identity: Record<string, string> }) => { searches++; assert.equal(options.identity.name, "Selected Customer"); assert.ok(!JSON.stringify(options).includes("private-note")); return report; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Read-only research must not prepare actions"); } },
  }, { AI_GATEWAY_API_KEY: "test-key" });
  const input = { mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "Untrusted company text", messages: [{ role: "user", content: "analsye the customer" }] };
  const off = await post(request(input));
  assert.equal(off.status, 200);
  assert.equal(searches, 0);
  assert.equal(loads, 0);
  const on = await post(request({ ...input, webSearch: true }));
  assert.equal(on.status, 200);
  const body = await on.json();
  assert.equal(searches, 1);
  assert.equal(loads, 1);
  assert.equal(body.research.sources[0].url, "https://example.com");
  assert.equal(body.research.findings, undefined);
  assert.deepEqual(body.actions, []);
  assert.match(prompt, /WEB_RESEARCH/);
  assert.match(prompt, /private-note/);
  assert.equal((await post(request({ ...input, webSearch: "true" }))).status, 400);
  assert.equal((await post(request({ ...input, webSearch: true }, "https://attacker.example"))).status, 403);
  assert.equal(searches, 1);
});

test("research about this customer passes the selected name, email and website and streams source progress", async () => {
  let searches = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
     "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({ currentCompanyId: id, currentCompany: { fields: { name: "3D Near You", contactEmail: "info@3dnearyou.com", website: "https://3dnearyou.com/", city: "Brooklyn", summary: "PRIVATE_CRM_NOTE" } } }) },
    "@/lib/ai/customer-research": { researchCustomer: async ({ identity, onProgress }: { identity: { name: string; email: string; website: string }; onProgress: (progress: ResearchProgress) => void }) => {
      searches++;
      assert.equal(identity.name, "3D Near You"); assert.equal(identity.email, "info@3dnearyou.com"); assert.equal(identity.website, "https://3dnearyou.com/");
      assert.doesNotMatch(JSON.stringify(identity), /PRIVATE_CRM_NOTE|about this customer/);
      const sources = [{ id: "W1", label: "3D Near You", url: identity.website, recordedAt: "2026-11-06T08:00:00Z" }];
      onProgress({ phase: "searching", sources: [], queries: [], visitedUrls: [] });
      onProgress({ phase: "reading", sources, queries: ['"3D Near You" Brooklyn'], visitedUrls: [] });
      return { status: "complete", findings: "New sourced business findings", queries: ['"3D Near You" Brooklyn'], sources, visitedUrls: [identity.website] };
    } },
    "@/lib/ai/gateway": { generateGatewayText: async ({ systemInstruction, prompt }: { systemInstruction: string; prompt: string }) => {
      assert.match(systemInstruction, /Do not fill the answer with CRM summaries/);
      assert.match(systemInstruction, /brands\/materials and sales channels/);
      assert.match(prompt, /WEB_RESEARCH_TARGET.*3D Near You/);
      return "New public customer intelligence.";
    } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Research must remain read-only"); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "analyze", pathname: `/companies/${id}`, pageLabel: "Company profile", pageText: "", messages: [{ role: "user", content: "Research about this customer" }], webSearch: true }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(searches, 1); assert.deepEqual(result.actions, []); assert.deepEqual(result.research.visitedUrls, ["https://3dnearyou.com/"]);
  const streaming = request({ mode: "analyze", pathname: `/companies/${id}`, pageLabel: "Company profile", pageText: "", messages: [{ role: "user", content: "Research about this customer" }], webSearch: true });
  streaming.headers.set("Accept", researchStreamType);
  const updates: ResearchProgress[] = [];
  const streamed = await readResearchResponse<{ output: string; research: { sources: Array<{ id: string }> } }>(await post(streaming), update => updates.push(update));
  assert.deepEqual(updates.map(update => update.phase), ["searching", "reading", "writing"]);
  assert.equal(updates[0].sources.length, 0);
  assert.equal(updates[1].sources[0].id, streamed.research.sources[0].id);
  assert.equal(streamed.output, "New public customer intelligence.");
});

test("Research Inovecell again from Analytics resolves the authorized company and returns research in Chat", async () => {
  let searches = 0;
  const content = "Research Inovecell again.";
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
     "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({ currentCompany: null, customerChoices: [{ id, name: "Inovecell", city: "Cachoeirinha", country: "Brazil" }] }) },
    "@/lib/ai/customer-research": { researchCustomer: async ({ identity }: { identity: { name: string; city: string } }) => {
      searches++; assert.equal(identity.name, "Inovecell"); assert.equal(identity.city, "Cachoeirinha");
      return { status: "complete", checkedAt: "now", findings: "A sourced namesake, not a confirmed company match.", queries: ["Inovecell Brazil"], sources: [{ id: "W1", url: "https://example.com/inovecell", label: "Registry" }], visitedUrls: ["https://example.com/inovecell"] };
    } },
    "@/lib/ai/gateway": { generateGatewayText: async ({ systemInstruction, prompt }: { systemInstruction: string; prompt: string }) => {
      assert.match(systemInstruction, /does not restrict public research/);
      assert.match(prompt, /WEB_RESEARCH_TARGET.*Inovecell/);
      assert.match(prompt, /Cachoeirinha/);
      return "Here is the sourced company research [W1].";
    } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Chat research must remain read-only"); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "analyze", pathname: "/analytics", pageLabel: "Analytics", pageText: "Aggregated metrics only", messages: [{ role: "user", content }], webSearch: webSearchForRequest("auto", content) }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(searches, 1); assert.equal(result.research.status, "complete"); assert.equal(result.research.visitedUrls.length, 1); assert.deepEqual(result.actions, []);
});

test("ambiguous cross-page research asks for a company before spending any provider tokens", async () => {
  const unexpected = async () => { throw new Error("No provider call should run before company selection"); };
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
     "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({ customerChoices: [{ id, name: "Inovecell", city: "Cachoeirinha" }, { id: viewer.id, name: "Inovecell", city: "Osasco" }] }) },
    "@/lib/ai/customer-research": { researchCustomer: unexpected }, "@/lib/ai/gateway": { generateGatewayText: unexpected }, "@/lib/ai/agent-execution": {},
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "analyze", pathname: "/analytics", pageLabel: "Analytics", pageText: "", messages: [{ role: "user", content: "Research Inovecell" }], webSearch: true }));
  assert.equal(response.status, 200); const result = await response.json();
  assert.match(result.clarification.question, /Cachoeirinha.*Osasco/); assert.deepEqual(result.actions, []); assert.equal(result.research, undefined);
});

test("customer research starts only after authentication and loading the authorized customer", async () => {
  let signedIn = true;
  let found = true;
  let searches = 0;
  const post = route("../app/api/companies/[id]/chat/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => signedIn ? viewer : null },
    "@/lib/data/crm": { getCompanyDetails: async () => ({ details: found ? { company: { name: "Saved Company", website: "example.com" } } : null }) },
    "@/lib/ai/company-chat": { ...companyChat, buildCompanyChatContext: () => ({ context: { coverage: { omittedActivity: 0 } }, sources: [{ id: "P", label: "Profile" }] }), buildCompanyChatPrompt: () => "CRM profile" },
    "@/lib/ai/gateway": { generateGatewayText: async () => "Report [P] [W1]" },

    "@/lib/ai/customer-research": { researchCustomer: async (options: { identity: { name: string } }) => { searches++; assert.equal(options.identity.name, "Saved Company"); return { status: "complete", findings: "Evidence", sources: [{ id: "W1", label: "Official", url: "https://example.com/" }] }; } },
  }, { AI_GATEWAY_API_KEY: "test-key" });
  const input = { webSearch: true, messages: [{ role: "user", content: "Analyze customer" }] };
  const context = { params: Promise.resolve({ id }) };
  signedIn = false;
  assert.equal((await post(request(input), context)).status, 401);
  signedIn = true; found = false;
  assert.equal((await post(request(input), context)).status, 404);
  assert.equal(searches, 0);
  found = true;
  const response = await post(request(input), context);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).sources.map((source: { id: string }) => source.id), ["P", "W1"]);
  assert.equal(searches, 1);
});

test("live progress requires an authenticated workspace member", async () => {
  const get = route("../app/api/ai/assistant/action/route.ts", { "@/lib/auth": { getWorkspaceViewer: async () => null }, "@/lib/supabase/admin": {}, "@/lib/ai/agent-actions": actions, "@/lib/ai/agent-execution": {} }, {}, "GET");
  assert.equal((await get(new Request(`http://localhost:3000/api/ai/assistant/action?id=${id}`))).status, 401);
});

test("manual approval proposals cannot auto-execute; raw model actions cannot bypass stored approval", async () => {
  const mock = actionRoute();
  assert.equal((await mock.post(request({ ...decision, approval: "auto" }))).status, 403);
  assert.equal((await mock.post(request(company))).status, 400);
  assert.equal(mock.executions(), 0);
  assert.equal(mock.row.status, "pending");
});

test("approval executes once across repeated and concurrent requests", async () => {
  const mock = actionRoute();
  const responses = await Promise.all([mock.post(request(decision)), mock.post(request(decision))]);
  assert.equal(responses.filter((response) => response.ok).length, 1);
  assert.equal(mock.executions(), 1);
  const repeat = await mock.post(request(decision));
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).status, "completed");
  assert.equal(mock.executions(), 1);
});

test("auto-approved proposals execute and declines never execute", async () => {
  const auto = actionRoute({ mode: "auto" });
  assert.equal((await auto.post(request({ ...decision, approval: "auto" }))).status, 200);
  assert.equal(auto.executions(), 1);
  const declined = actionRoute();
  assert.equal((await declined.post(request({ ...decision, decision: "decline" }))).status, 200);
  assert.equal(declined.row.status, "declined");
  assert.equal(declined.executions(), 0);
  assert.equal((await declined.post(request(decision))).status, 409);
});

test("declining remaining workflow work preserves confirmed progress in saved result reads", async () => {
  const mock = actionRoute();
  mock.row.result = { workflow: { completed: 1, total: 2, steps: [{ id: "customer", tool: "create_company", status: "completed" }] }, href: "/companies/saved" };
  const response = await mock.post(request({ ...decision, decision: "decline" }));
  assert.equal(response.status, 200);
  const saved = await (await mock.get(new Request(`http://localhost:3000/api/ai/assistant/action?id=${id}`))).json();
  assert.equal(saved.workflow.completed, 1);
  assert.equal(saved.href, "/companies/saved");
  assert.match(saved.success, /Saved results are kept/);
  assert.doesNotMatch(saved.success, /Nothing was changed/);
  assert.equal(mock.executions(), 0);
});

test("rejects other users, viewers, expired proposals, and cross-origin approvals", async () => {
  assert.equal((await actionRoute({ owner: "someone-else" }).post(request(decision))).status, 404);
  assert.equal((await actionRoute({ role: "viewer" }).post(request(decision))).status, 403);
  assert.equal((await actionRoute({ expired: true }).post(request(decision))).status, 409);
  assert.equal((await actionRoute().post(request(decision, "https://other.example"))).status, 403);
});

test("partial failures retain the invoice link and cannot blindly resend", async () => {
  const mock = actionRoute({ fail: true });
  const response = await mock.post(request(decision));
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.equal(result.href, "/invoices/saved");
  assert.match(result.error, /mailbox failed/);
  assert.equal(mock.row.status, "failed");
  assert.equal((await mock.post(request(decision))).status, 409);
  assert.equal(mock.executions(), 1);
});

test("chat remains read-only even when a provider emits valid action JSON", async () => {
  let prepared = 0;
  let contextLoads = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async () => `Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}` },

    "@/lib/ai/agent-context": { loadAgentContext: async () => { contextLoads++; return {}; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { AI_GATEWAY_API_KEY: "test-provider" });
  const response = await post(request({ mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create Acme" }] }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).actions, []);
  assert.equal(prepared, 0);
  assert.equal(contextLoads, 0);
});

test("agent uses its separate model and stores the requested approval mode before executing", async () => {
  let selectedModel = "";
  let storedMode = "";
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async (options: { model: string }) => { selectedModel = options.model; return `Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}`; } },

    "@/lib/ai/agent-context": { loadAgentContext: async () => ({ currentCompanyId: null }) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (_actions: unknown, _viewer: unknown, mode: string) => { storedMode = mode; return [{ id, action: company, approvalMode: mode }]; } },
  }, { AI_GATEWAY_API_KEY: "test-provider", AI_GATEWAY_CHAT_MODEL: "chat-model", AI_GATEWAY_AGENT_MODEL: "agent-model" });
  const response = await post(request({ mode: "work", approvalMode: "auto", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create Acme" }] }));
  assert.equal(response.status, 200);
  assert.equal(selectedModel, "agent-model");
  assert.equal(storedMode, "auto");
  assert.equal((await response.json()).actions[0].id, id);
});

test("agent keeps the configured Gateway email model when no override is configured", async () => {
  let selectedModel = "";
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async (options: { model: string }) => { selectedModel = options.model; return "Which products should I add?"; } },

    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => [] },
  }, { AI_GATEWAY_API_KEY: "existing-gateway-key", AI_GATEWAY_EMAIL_MODEL: "existing-working-model" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create an invoice for 10 Black PLA" }] }));
  assert.equal(response.status, 200);
  assert.equal(selectedModel, "existing-working-model");
});

test("email context failures are reported separately from provider failures and never create proposals", async () => {
  let generated = 0;
  let prepared = 0;
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gateway": { generateGatewayText: async () => { generated++; return "Ready"; } },

    "@/lib/ai/agent-context": { loadAgentContext: async () => { throw new Error("Private database failure details"); } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { AI_GATEWAY_API_KEY: "existing-gateway-key" });
  const response = await post(request({ language: "zh-CN", mode: "work", pathname: "/email", pageContext: { emailId: "mail-1" }, pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Create profile for this company" }] }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, i18n.translateUiText("Unable to load the selected email or CRM records. Refresh the page and try again.", "zh-CN"));
  assert.equal(generated, 0);
  assert.equal(prepared, 0);
});

test("CRM analysis attaches verified presentation data before saving the response", async () => {
  let generated = 0;
  let saved: Record<string, unknown> | undefined;
  const messages = [{ role: "user", content: "Review my invoices" }];
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/chat-session": { startChatSession: async () => ({ messages, completedActionIds: [], complete: async (payload: Record<string, unknown>) => { saved = payload; return payload; }, flush: async () => {} }) },
    "@/lib/ai/gateway": { generateGatewayText: async () => ++generated === 1 ? 'FILAZOO_CRM_READ_JSON: {"resource":"invoices"}' : "These invoices are drafts. Review the cards below." },
    "@/lib/ai/crm-records": { readCrmRecords: async (actor: unknown) => {
      assert.equal(actor, viewer);
      return { records: [{ id, number: 1017, status: "draft", total_minor: 4963, paid_minor: 0, document: { customerName: "Saved buyer", currency: "USD", dueDate: "2026-11-12" } }], coverage: { matching: 1, nextOffset: null } };
    } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Read-only analysis must not create actions"); } },
  }, { AI_GATEWAY_API_KEY: "synthetic" });
  const response = await post(request({ mode: "analyze", pathname: "/", pageLabel: "Home", pageText: "", messages }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.presentation.sections[0].rows[0].cells.balance, "USD 49.63");
  assert.equal(body.presentation.sections[0].rows[0].status, "Draft");
  assert.equal(body.presentation.sections[0].metrics.find((metric: { label: string }) => metric.label === "Overdue").value, "0");
  assert.deepEqual(body.actions, []);
  assert.deepEqual(JSON.parse(JSON.stringify(saved?.presentation)), body.presentation, "history receives the same validated snapshot as the visible response");
});
