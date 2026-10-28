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

const require = createRequire(import.meta.url);
// Run the actual route handlers with isolated auth/provider/database boundaries.
// No test signs in to the real workspace, saves an invoice, or sends an email.
function route(file: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}, method: "POST" | "GET" = "POST") {
  const exports: { POST?: (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>; GET?: (request: Request) => Promise<Response> } = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? (name === "@/lib/ai/crm-tools" ? crmTools : name === "@/lib/ai/crm-records" ? {} : name === "@/lib/i18n" ? i18n : name === "@/lib/ai/customer-research" ? research : name === "@/lib/ai/image-input" ? imageInput : require(name)), Response, Request, URL, AbortSignal, Date, Error, crypto, console, process: { env } });
  return exports[method]!;
}

const viewer = { id: "a37acc59-4a11-47db-ad1e-aa9fe5d72e74", role: "admin" };
const id = "15693adc-0bdf-4617-b214-71b1861764a9";
const company = { type: "create_company", company: { name: "Acme", country: "US", segment: "Retail" } };
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/ai/assistant/action", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
const decision = { id, decision: "approve", approval: "manual" };

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
        "@/lib/ai/gemini": { generateGeminiText: async () => `\`\`\`json\n${JSON.stringify(email)}\n\`\`\`${valid ? `\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([action])}` : ""}` },
        "@/lib/ai/gateway": {}, "@/lib/ai/assistant-provider-error": providerError,
        "@/lib/ai/agent-execution": { prepareAgentActions: async (values: assistant.WorkspaceAction[]) => { prepared += values.length; return []; } },
      }, { GEMINI_API_KEY: "synthetic" });
      const response = await post(request({ mode, pathname: "/emails", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Write an email and attach the catalog PDF" }] }));
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
      "@/lib/ai/gemini": { generateGeminiText: async ({ prompt }: { prompt: string }) => { assert.match(prompt, /I need 500 kg PLA/); return `Reply ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([action])}`; } },
      "@/lib/ai/gateway": {}, "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/agent-execution": { prepareAgentActions: async (values: assistant.WorkspaceAction[]) => { preparations++; assert.equal(values[0].type, "write_email"); if (values[0].type === "write_email") assert.equal(values[0].email.mailboxId, id); return []; } },
    }, { GEMINI_API_KEY: "synthetic" });
    const response = await post(request({ mode, pathname: "/emails", pageLabel: "Email", pageText: "", pageContext: { emailId: "selected-email", mailboxId: id }, messages: [{ role: "user", content: "Write a reply to this" }] }));
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
      "@/lib/ai/gemini": { generateGeminiText: async ({ images, prompt }: { images: imageInput.ProviderImage[]; prompt: string }) => {
        assert.equal(images[0].dataUrl, image.dataUrl);
        assert.match(prompt, /Message 1, image 1/);
        assert.ok(!prompt.includes("base64"));
        throw new Error("Regional availability");
      } },
      "@/lib/ai/gateway": { isGeminiRegionError: () => true, generateGatewayText: async ({ images, visionModel }: { images: imageInput.ProviderImage[]; visionModel: string }) => {
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
    }, { GEMINI_API_KEY: "test", AI_GATEWAY_API_KEY: "test", AI_GATEWAY_VISION_MODEL: "test-vision-model" });
    const body = { mode, pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Update this customer's shipping address from the image.", images: [image] }] };
    const response = await post(request(body));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.output, "Address read from the image.");
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
    "@/lib/ai/gemini": { generateGeminiText: async ({ images, prompt }: { images: imageInput.ProviderImage[]; prompt: string }) => {
      assert.equal(loaded, true);
      assert.deepEqual(images, [{ ...image, label: "Message 1, image 1" }]);
      assert.match(prompt, /What is the postal code/);
      assert.ok(!prompt.includes("base64"));
      return "The image shows postal code 12345.";
    } },
    "@/lib/ai/gateway": {},
  }, { GEMINI_API_KEY: "test" });
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
    "@/lib/ai/gemini": { generateGeminiText: async ({ prompt }: { prompt: string }) => { prompts.push(prompt); generated++; return generated === 1 ? `FILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}\nFILAZOO_EMAIL_SEARCH_JSON: {"companyId":"${id}"}` : `Shipping address ready for review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposed])}`; } },
    "@/lib/ai/gateway": {},
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}), searchAgentEmails: async (_viewer: unknown, search: { companyId: string }) => { reads++; assert.equal(search.companyId, id); assert.equal(stored, undefined); return { messages: [{ id: "mail-1", text: "Ship to 99 New Road" }] }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (actions: unknown, _viewer: unknown, mode: string) => { stored = actions; assert.equal(mode, "auto"); return []; } },
  }, { GEMINI_API_KEY: "test-key" });
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
      "@/lib/ai/gemini": { generateGeminiText: async () => `FILAZOO_EMAIL_SEARCH_JSON: ${scenario === "invalid" ? '{"companyId":"forged"}' : '{}'} ` },
      "@/lib/ai/gateway": {},
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}), searchAgentEmails: async () => { reads++; if (scenario === "failure") throw new Error("Private mailbox detail"); return { messages: [] }; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepares++; return []; } },
    }, { GEMINI_API_KEY: "test-key" });
    const response = await post(request({ mode: scenario === "analyze" ? "analyze" : "work", pathname: "/emails", pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Check emails" }] }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.actions, []);
    assert.equal(prepares, 0);
    assert.equal(reads, scenario === "limit" ? 2 : scenario === "failure" ? 1 : 0);
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
    "@/lib/ai/gemini": { generateGeminiText: async ({ prompt }: { prompt: string }) => {
      generated++;
      if (generated === 1) return 'FILAZOO_CRM_READ_JSON: {"resource":"companies","query":"Acme"}';
      assert.match(prompt, /CRM_READ_RESULTS/); assert.match(prompt, /Verified Acme/);
      return `Ready for review.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([proposal])}`;
    } }, "@/lib/ai/gateway": {}, "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/crm-records": { readCrmRecords: async (actor: { id: string }, lookup: crmTools.CrmRead) => { read++; assert.equal(actor.id, viewer.id); assert.equal(lookup.resource, "companies"); assert.equal(prepared, 0); return { records: [{ id, name: "Verified Acme" }], coverage: { included: 1 } }; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (actions: unknown) => { prepared++; assert.equal(JSON.stringify(actions), JSON.stringify([proposal])); return []; } },
  }, { GEMINI_API_KEY: "synthetic" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Schedule Acme follow-up tomorrow at 9am" }] }));
  assert.equal(response.status, 200); assert.equal(read, 1); assert.equal(prepared, 1); assert.equal(generated, 2);
  assert.ok(!(await response.json()).output.includes("FILAZOO_"));
});

test("CRM read failures and read budgets never create partial mutations or run in Chat mode", async () => {
  for (const scenario of ["failure", "budget", "analyze"]) {
    let reads = 0;
    let preparations = 0;
    const post = route("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/ai/workspace-assistant": assistant, "@/lib/ai/assistant-provider-error": providerError,
      "@/lib/ai/gemini": { generateGeminiText: async () => 'FILAZOO_CRM_READ_JSON: {"resource":"products"}' }, "@/lib/ai/gateway": {},
      "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
      "@/lib/ai/crm-records": { readCrmRecords: async () => { reads++; if (scenario === "failure") throw new Error("Private connection error"); return { records: [] }; } },
      "@/lib/ai/agent-execution": { prepareAgentActions: async () => { preparations++; return []; } },
    }, { GEMINI_API_KEY: "synthetic" });
    const response = await post(request({ mode: scenario === "analyze" ? "analyze" : "work", pathname: "/catalogs", pageLabel: "Products", pageText: "", messages: [{ role: "user", content: "Find PLA" }] }));
    const body = await response.json();
    assert.deepEqual(body.actions, []); assert.equal(preparations, 0); assert.equal(reads, scenario === "budget" ? 4 : scenario === "failure" ? 1 : 0);
    assert.ok(!body.output.includes("Private connection error")); assert.ok(!body.output.includes("FILAZOO_"));
  }
});

function actionRoute(options: { mode?: string; role?: string; owner?: string; expired?: boolean; fail?: boolean } = {}) {
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

test("workspace web research uses selected server identity, returns source links, and remains read-only", async () => {
  let searches = 0;
  let loads = 0;
  let prompt = "";
  const report = { status: "complete", checkedAt: new Date().toISOString(), findings: "Public evidence", sources: [{ id: "W1", label: "Official site", url: "https://example.com" }], queries: [] };
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gemini": { generateGeminiText: async (options: { prompt: string }) => { prompt = options.prompt; return `Company report [W1].\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}`; } },
    "@/lib/ai/gateway": {},
    "@/lib/ai/agent-context": { loadAgentContext: async () => { loads++; return { currentCompany: { fields: { name: "Selected Customer", website: "example.com", contactEmail: "buyer@example.com", summary: "private-note" } } }; } },
    "@/lib/ai/customer-research": { researchCustomer: async (options: { identity: Record<string, string> }) => { searches++; assert.equal(options.identity.name, "Selected Customer"); assert.ok(!JSON.stringify(options).includes("private-note")); return report; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { throw new Error("Read-only research must not prepare actions"); } },
  }, { GEMINI_API_KEY: "test-key" });
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

test("customer research starts only after authentication and loading the authorized customer", async () => {
  let signedIn = true;
  let found = true;
  let searches = 0;
  const post = route("../app/api/companies/[id]/chat/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => signedIn ? viewer : null },
    "@/lib/data/crm": { getCompanyDetails: async () => ({ details: found ? { company: { name: "Saved Company", website: "example.com" } } : null }) },
    "@/lib/ai/company-chat": { ...companyChat, buildCompanyChatContext: () => ({ context: { coverage: { omittedActivity: 0 } }, sources: [{ id: "P", label: "Profile" }] }), buildCompanyChatPrompt: () => "CRM profile" },
    "@/lib/ai/gemini": { generateGeminiText: async () => "Report [P] [W1]" },
    "@/lib/ai/gateway": {},
    "@/lib/ai/customer-research": { researchCustomer: async (options: { identity: { name: string } }) => { searches++; assert.equal(options.identity.name, "Saved Company"); return { status: "complete", findings: "Evidence", sources: [{ id: "W1", label: "Official", url: "https://example.com/" }] }; } },
  }, { GEMINI_API_KEY: "test-key" });
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
    "@/lib/ai/gemini": { generateGeminiText: async () => `Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}` },
    "@/lib/ai/gateway": {},
    "@/lib/ai/agent-context": { loadAgentContext: async () => { contextLoads++; return {}; } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { GEMINI_API_KEY: "test-provider" });
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
    "@/lib/ai/gemini": { generateGeminiText: async (options: { model: string }) => { selectedModel = options.model; return `Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([company])}`; } },
    "@/lib/ai/gateway": {},
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({ currentCompanyId: null }) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async (_actions: unknown, _viewer: unknown, mode: string) => { storedMode = mode; return [{ id, action: company, approvalMode: mode }]; } },
  }, { GEMINI_API_KEY: "test-provider", GEMINI_CHAT_MODEL: "chat-model", GEMINI_AGENT_MODEL: "agent-model" });
  const response = await post(request({ mode: "work", approvalMode: "auto", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create Acme" }] }));
  assert.equal(response.status, 200);
  assert.equal(selectedModel, "agent-model");
  assert.equal(storedMode, "auto");
  assert.equal((await response.json()).actions[0].id, id);
});

test("agent keeps the existing working Gemini model when no override is configured", async () => {
  let selectedModel = "";
  const post = route("../app/api/ai/assistant/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/assistant-provider-error": providerError,
    "@/lib/ai/gemini": { generateGeminiText: async (options: { model: string }) => { selectedModel = options.model; return "Which products should I add?"; } },
    "@/lib/ai/gateway": {},
    "@/lib/ai/agent-context": { loadAgentContext: async () => ({}) },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => [] },
  }, { GEMINI_API_KEY: "existing-gemini-key", GEMINI_EMAIL_MODEL: "existing-working-model" });
  const response = await post(request({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "Create an invoice" }] }));
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
    "@/lib/ai/gemini": { generateGeminiText: async () => { generated++; return "Ready"; } },
    "@/lib/ai/gateway": {},
    "@/lib/ai/agent-context": { loadAgentContext: async () => { throw new Error("Private database failure details"); } },
    "@/lib/ai/agent-execution": { prepareAgentActions: async () => { prepared++; return []; } },
  }, { GEMINI_API_KEY: "existing-gemini-key" });
  const response = await post(request({ language: "zh-CN", mode: "work", pathname: "/emails", pageContext: { emailId: "mail-1" }, pageLabel: "Email", pageText: "", messages: [{ role: "user", content: "Create profile for this company" }] }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, i18n.translateUiText("Unable to load the selected email or CRM records. Refresh the page and try again.", "zh-CN"));
  assert.equal(generated, 0);
  assert.equal(prepared, 0);
});
