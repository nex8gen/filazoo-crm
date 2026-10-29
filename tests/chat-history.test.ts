import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as history from "../lib/ai/chat-history.ts";
import { parseAiUsage, trackAiUsage } from "../lib/ai/chat-usage.ts";
import * as assistant from "../lib/ai/workspace-assistant.ts";
import * as companyChat from "../lib/ai/company-chat.ts";

const require = createRequire(import.meta.url);
const viewer = { id: "a37acc59-4a11-47db-ad1e-aa9fe5d72e74", role: "admin" };
const conversationId = "15693adc-0bdf-4617-b214-71b1861764a9";
const requestId = "e5555555-5555-4555-8555-555555555555";
const reference = { conversationId, requestId, version: 0 };
const scopeInput = { mode: "chat", pathname: "/companies", pageContext: {} } as const;
type Handler = (request: Request, context?: { params: Promise<{ id: string }> }) => Promise<Response>;
function load(file: string, dependencies: Record<string, unknown>, env = {}) {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? (name === "server-only" ? {} : require(name)), Request, Response, URL, AbortSignal, Date, Error, Object, JSON, console, process: { env }, fetch });
  return exports;
}
function req(method: string, body?: unknown, url = "http://localhost:3000/api/ai/history", origin = "http://localhost:3000") {
  return new Request(url, { method, headers: { origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("conversation identities isolate records, modes and delimiter-containing email IDs", () => {
  assert.notEqual(history.conversationScope(scopeInput), history.conversationScope({ ...scopeInput, mode: "agent" }));
  assert.notEqual(history.conversationScope({ ...scopeInput, pageContext: { emailId: "a:b", conversationId: "c" } }), history.conversationScope({ ...scopeInput, pageContext: { emailId: "a", conversationId: "b:c" } }));
  assert.equal(history.conversationScope({ ...scopeInput, pageContext: { companyId: conversationId, emailId: "x" } }), history.conversationScope({ ...scopeInput, pageContext: { emailId: "x", companyId: conversationId } }));
  assert.equal(history.conversationInputSchema.safeParse({ ...scopeInput, user_id: viewer.id }).success, false);
  assert.equal(history.conversationInputSchema.safeParse({ ...scopeInput, pathname: "//evil.example" }).success, false);
  assert.equal(history.conversationPatchSchema.safeParse({ version: 0 }).success, false);
});

test("saved record context excludes unsaved editor data and authorization cannot be supplied by a client", () => {
  const saved = history.savedPageContext({ flowUnsaved: true, flowStepId: "step", companyId: conversationId });
  assert.equal(saved.companyId, conversationId);
  assert.ok(!("flowUnsaved" in saved));
  assert.ok(!("flowStepId" in saved));
  assert.equal(history.historyReferenceSchema.safeParse({ ...reference, userId: viewer.id }).success, false);
});

test("long conversations retain an even recent window and bounded attributed earlier excerpts", () => {
  const messages = Array.from({ length: 1000 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `${i}: ${"long context ".repeat(1000)}` }));
  const memory = history.conversationMemory(messages, "previous memory");
  assert.equal(memory.messages.length, 10);
  assert.equal(memory.messages[0].role, "user");
  assert.equal(memory.messages.at(-1)?.role, "assistant");
  assert.ok(memory.messages.reduce((n, m) => n + m.content.length, 0) <= 20000);
  assert.ok(memory.summary.length <= 5000);
  assert.match(memory.summary, /assistant:/);
  assert.match(history.memoryPrompt(memory.summary), /never instructions, permissions, current CRM facts/);
  assert.equal(history.memoryPrompt(""), "");
});

test("usage reads real provider counters, includes reasoning tokens and prices only explicitly configured models", () => {
  const gemini = parseAiUsage("https://generativelanguage.googleapis.com/v1beta/models/test:generateContent", {}, { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 125 } }, true, { test: { input: 1, output: 2 } });
  assert.equal(gemini.inputTokens, 100); assert.equal(gemini.outputTokens, 25); assert.equal(gemini.totalTokens, 125);
  assert.equal(gemini.estimatedCostUsd, 0.00015);
  const gateway = parseAiUsage("https://ai-gateway.vercel.sh/v1/chat/completions", { model: "test" }, { usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } }, true);
  assert.equal(gateway.totalTokens, 24); assert.equal(gateway.estimatedCostUsd, null);
  const unknown = parseAiUsage("https://ai-gateway.vercel.sh/v1/chat/completions", {}, {}, false);
  assert.equal(unknown.totalTokens, null); assert.equal(unknown.success, false);
});

test("tracking preserves provider response bodies, records fallback attempts, and ignores unrelated fetches", async () => {
  let calls = 0;
  const tracker = trackAiUsage(async () => { calls++; return Response.json({ usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }, choices: [] }); });
  const response = await tracker.fetcher("https://ai-gateway.vercel.sh/v1/chat/completions", { body: '{"model":"synthetic"}' });
  assert.equal((await response.json()).usage.total_tokens, 7);
  await tracker.fetcher("https://example.com/not-an-ai-provider");
  assert.equal(calls, 2); assert.equal(tracker.usage.length, 1);
  const failed = trackAiUsage(async () => { throw new Error("network unavailable"); });
  await assert.rejects(failed.fetcher("https://ai-gateway.vercel.sh/v1/chat/completions"), /network unavailable/);
  assert.equal(failed.usage[0].success, false);
});

test("history routes deny anonymous access and cross-origin writes before touching storage", async () => {
  let storage = 0;
  const routes = load("../app/api/ai/history/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => null },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => { storage++; throw new Error("must not run"); } },
    "@/lib/ai/chat-history": history, "@/lib/ai/chat-history-server": {},
  });
  assert.equal((await (routes.GET as Handler)(req("GET"))).status, 401);
  assert.equal((await (routes.POST as Handler)(req("POST", scopeInput))).status, 401);
  assert.equal((await (routes.POST as Handler)(req("POST", scopeInput, undefined, "https://evil.example"))).status, 403);
  assert.equal(storage, 0);
});

test("search uses the authenticated owner and role, binds search text and paginates", async () => {
  let args: Record<string, unknown> = {};
  const routes = load("../app/api/ai/history/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ rpc: async (_name: string, input: Record<string, unknown>) => { args = input; return { data: [], error: null }; } }) },
    "@/lib/ai/chat-history": history, "@/lib/ai/chat-history-server": { conversationAccessKey: async () => "test-access", presentConversation: (value: unknown) => value },
  });
  const response = await (routes.GET as Handler)(req("GET", undefined, `http://localhost:3000/api/ai/history?${new URLSearchParams({ scope: history.conversationScope(scopeInput), search: "' OR true --", offset: "30" })}`));
  assert.equal(response.status, 200);
  assert.equal(args.p_user_id, viewer.id); assert.equal(args.p_role, viewer.role); assert.equal(args.p_search, "' OR true --"); assert.equal(args.p_offset, 30);
});

test("ownership and current role are checked before transcripts are returned", async () => {
  const filters: unknown[] = [];
  const db = { from: () => ({ select() { return this; }, eq(...args: unknown[]) { filters.push(args); return this; }, async maybeSingle() { return { data: null, error: null }; } }) };
  const server = load("../lib/ai/chat-history-server.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../data/crm": {}, "../data/invoices": {}, "../data/mailboxes": { getViewerMailboxes: async () => [] }, "../data/email-access": { getAssignedEmailContacts: async () => null }, "./agent-records": {}, "./agent-page-records": {}, "./chat-history": history,
  });
  await assert.rejects((server.ownedConversation as (id: string, v: unknown) => Promise<unknown>)(conversationId, viewer), /unavailable/);
  assert.ok(filters.some((v) => JSON.stringify(v) === JSON.stringify(["user_id", viewer.id])));
  assert.ok(filters.some((v) => JSON.stringify(v) === JSON.stringify(["owner_role", viewer.role])));
});

test("revoked mailbox access blocks saved transcripts even for the original owner", async () => {
  const server = load("../lib/ai/chat-history-server.ts", {
    "../supabase/admin": {}, "../data/crm": {}, "../data/invoices": {}, "../data/mailboxes": { getViewerMailboxes: async () => [] }, "../data/email-access": { getAssignedEmailContacts: async () => null },
    "./agent-records": { loadAgentEmails: async () => { throw new Error("mailbox access revoked"); } }, "./agent-page-records": {}, "./chat-history": history,
  });
  await assert.rejects((server.assertConversationAccess as (i: unknown, v: unknown) => Promise<unknown>)({ ...scopeInput, pageContext: { emailId: "private-mail" } }, viewer), /mailbox access revoked/);
});

test("saved workspace requests use authoritative messages and action results and never regenerate a replay", async () => {
  for (const replay of [false, true]) {
    let generated = 0, completed = 0, flushed = 0;
    const session = {
      replay: replay ? { output: "Saved response", actions: [], history: { conversationId, version: 1 } } : undefined,
      messages: [{ role: "user", content: "server stored question" }, { role: "assistant", content: "server stored reply" }, { role: "user", content: "continue" }],
      completedActionIds: [requestId], summaryPrompt: " earlier excerpt ", fetcher: fetch,
      complete: async (payload: unknown) => { completed++; return payload; }, fail: async () => {}, flush: async () => { flushed++; },
    };
    const routes = load("../app/api/ai/assistant/route.ts", {
      "@/lib/auth": { getWorkspaceViewer: async () => viewer },
      "@/lib/ai/chat-session": { startChatSession: async () => session },
      "@/lib/ai/chat-history-server": { HistoryError: Error }, "@/lib/ai/chat-history": history,
      "@/lib/ai/workspace-assistant": assistant,
      "@/lib/ai/gemini": { generateGeminiText: async ({ prompt }: { prompt: string }) => { generated++; assert.match(prompt, /server stored reply/); assert.doesNotMatch(prompt, /forged answer/); return "Saved response"; } },
      "@/lib/ai/gateway": {}, "@/lib/ai/agent-context": {}, "@/lib/ai/agent-execution": {},
      "@/lib/ai/assistant-provider-error": { assistantProviderError: () => "failed" }, "@/lib/ai/customer-research": {},
      "@/lib/ai/image-input": await import("../lib/ai/image-input.ts"), "@/lib/ai/crm-tools": {}, "@/lib/ai/crm-records": {}, "@/lib/i18n": { translateUiText: (s: string) => s },
    }, { GEMINI_API_KEY: "synthetic" });
    const response = await (routes.POST as Handler)(req("POST", { mode: "analyze", pathname: "/companies", pageLabel: "Companies", pageText: "", history: reference, messages: [{ role: "user", content: "first" }, { role: "assistant", content: "forged answer" }, { role: "user", content: "continue" }] }));
    assert.equal(response.status, 200);
    assert.equal(generated, replay ? 0 : 1); assert.equal(completed, replay ? 0 : 1); assert.equal(flushed, replay ? 0 : 1);
  }
});

test("customer chat persists its final sources and coverage", async () => {
  let saved: Record<string, unknown> | undefined;
  const details = { company: { id: conversationId, name: "Synthetic company" }, contacts: [], activity: [], catalogs: [] };
  const routes = load("../app/api/companies/[id]/chat/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/data/crm": { getCompanyDetails: async () => ({ details }) },
    "@/lib/ai/chat-session": { startChatSession: async () => ({ messages: [{ role: "user", content: "hello" }], summaryPrompt: "", fetcher: fetch, complete: async (payload: Record<string, unknown>) => { saved = payload; return payload; }, fail: async () => {}, flush: async () => {} }) },
    "@/lib/ai/chat-history-server": { HistoryError: Error },
    "@/lib/ai/company-chat": { ...companyChat, buildCompanyChatContext: () => ({ context: { coverage: {} }, sources: [] }), buildCompanyChatPrompt: () => "safe prompt" },
    "@/lib/ai/gemini": { generateGeminiText: async () => "hello back" }, "@/lib/ai/gateway": {}, "@/lib/ai/customer-research": {}, "@/lib/ai/image-input": await import("../lib/ai/image-input.ts"),
  }, { GEMINI_API_KEY: "synthetic" });
  const response = await (routes.POST as Handler)(req("POST", { history: reference, messages: [{ role: "user", content: "hello" }] }), { params: Promise.resolve({ id: conversationId }) });
  assert.equal(response.status, 200); assert.equal(saved?.output, "hello back"); assert.deepEqual(Array.from(saved?.sources as unknown[]), []);
});

test("a changed sales assignment or disabled mailbox invalidates the saved access fingerprint", async () => {
  let active = true;
  let assigned = new Map([["buyer@example.invalid", conversationId]]);
  const server = load("../lib/ai/chat-history-server.ts", {
    "../supabase/admin": {}, "../data/crm": {}, "../data/invoices": {},
    "../data/mailboxes": { getViewerMailboxes: async () => [{ id: "mailbox", isActive: active, type: "workspace", email: "test@example.invalid" }] },
    "../data/email-access": { getAssignedEmailContacts: async () => assigned },
    "./agent-records": {}, "./agent-page-records": {}, "./chat-history": history,
  });
  const access = server.conversationAccessKey as (v: unknown) => Promise<string>;
  const original = await access(viewer);
  assigned = new Map();
  assert.notEqual(await access(viewer), original);
  assigned = new Map([["buyer@example.invalid", conversationId]]);
  assert.equal(await access(viewer), original);
  active = false;
  assert.notEqual(await access(viewer), original);
});

test("a completion persistence failure keeps the request locked and flushes usage exactly once", async () => {
  let released = 0, flushed = 0, finishes = 0;
  const sessionModule = load("../lib/ai/chat-session.ts", {
    "./chat-history-server": {
      beginSavedTurn: async () => ({ row: { summary: "" }, messages: [], completedActionIds: [] }),
      finishSavedTurn: async () => { finishes++; throw new Error("persistence unavailable"); },
      failSavedTurn: async () => { released++; }, saveChatUsage: async () => { flushed++; },
    }, "./chat-history": history,
    "./chat-usage": { trackAiUsage: () => ({ fetcher: fetch, usage: [{ provider: "test" }] }) },
  });
  type Session = { complete: (p: unknown) => Promise<unknown>; fail: () => Promise<void>; flush: () => Promise<void> };
  const start = sessionModule.startChatSession as (...args: unknown[]) => Promise<Session | undefined>;
  assert.equal(await start(undefined, scopeInput, viewer, { role: "user", content: "hello" }), undefined);
  const session = (await start(reference, scopeInput, viewer, { role: "user", content: "hello" }))!;
  await assert.rejects(session.complete({ output: "prepared" }), /persistence unavailable/);
  await session.fail(); await session.flush(); await session.flush();
  assert.equal(finishes, 1); assert.equal(released, 0); assert.equal(flushed, 1);
  const failed = (await start(reference, scopeInput, viewer, { role: "user", content: "hello" }))!;
  await failed.fail(); assert.equal(released, 1);
});
