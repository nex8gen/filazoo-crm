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

const require = createRequire(import.meta.url);
// Run the actual route handlers with isolated auth/provider/database boundaries.
// No test signs in to the real workspace, saves an invoice, or sends an email.
function route(file: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}, method: "POST" | "GET" = "POST") {
  const exports: { POST?: (request: Request) => Promise<Response>; GET?: (request: Request) => Promise<Response> } = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? (name === "@/lib/i18n" ? i18n : require(name)), Response, Request, URL, AbortSignal, Date, Error, crypto, console, process: { env } });
  return exports[method]!;
}

const viewer = { id: "a37acc59-4a11-47db-ad1e-aa9fe5d72e74", role: "admin" };
const id = "15693adc-0bdf-4617-b214-71b1861764a9";
const company = { type: "create_company", company: { name: "Acme", country: "US", segment: "Retail" } };
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/ai/assistant/action", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
const decision = { id, decision: "approve", approval: "manual" };

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
