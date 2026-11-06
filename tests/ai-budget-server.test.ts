import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as budget from "../lib/ai/budget.ts";
import * as budgetFetch from "../lib/ai/budget-fetch.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { policyTestDependency } from "./helpers/ai-policy.ts";
const require = createRequire(import.meta.url);
function load(file: string, deps: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? policyTestDependency(name) ?? require(name), fetch: fetcher, Response, Request, AbortSignal, URL, Date, console });
  return exports;
}
test("published prices include context tiers and cache writes, and RPC receives only trusted owner", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const admin = { rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { data: name === "reserve_ai_budget" ? { allowed: true, reservationId: "reservation" } : { monthly: {} }, error: null }; } };
  const loaded = load("../lib/ai/budget-server.ts", { "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "./budget.ts": budget, "./budget-fetch.ts": budgetFetch }, async () => Response.json({ data: [{ id: "openai/gpt-5-nano", context_window: 1050000, pricing: { input: "0.0000001", input_cache_write: "0.000000125", output: "0.0000005", web_search: "10", input_tiers: [{ min: 272001, cost: "0.0000002" }], output_tiers: [{ min: 272001, cost: "0.00000075" }], input_cache_write_tiers: [{ min: 272001, cost: "0.00000025" }] } }] }));
  const price = await (loaded.readBudgetRate as (model: string) => Promise<budget.BudgetRate>)("openai/gpt-5-nano");
  assert.equal(price.input, .000000125); assert.equal(price.webSearch, .01);
  assert.equal(price.tiers?.[0].input, .00000025);
  await assert.rejects((loaded.readBudgetRate as (model: string) => Promise<unknown>)("unpriced"), /not configured/);
  const guarded = (loaded.budgetedAiFetch as (owner: string, fetcher: typeof fetch) => typeof fetch)("trusted", async () => Response.json({ usage: { input_tokens: 100, output_tokens: 10 } }));
  await guarded("https://ai-gateway.vercel.sh/v1/responses", { body: JSON.stringify({ model: "openai/gpt-5-nano", input: "Hello", max_output_tokens: 100 }) });
  assert.equal(rpcCalls[0].name, "reserve_ai_budget"); assert.equal(rpcCalls[0].args.p_user_id, "trusted");
  assert.equal(rpcCalls[1].name, "settle_ai_budget"); assert.equal(rpcCalls[1].args.p_micros, 18);
});
test("usage API authenticates before reading totals and returns no allowance limits", async () => {
  let viewer: { id: string } | null = null, calls = 0, failure = false;
  const loaded = load("../app/api/ai/usage/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ rpc: async (name: string, args: { p_user_id: string }) => {
      calls++; assert.equal(name, "ai_chat_usage_totals"); assert.equal(args.p_user_id, "signed-in");
      return { data: { calls: 5 }, error: failure ? { message: "Unavailable" } : null };
    } }) },
    "@/lib/ai/budget-server": { readAiBudget: async () => { throw new Error("Usage must not read allowance limits"); } },
  });
  const get = loaded.GET as () => Promise<Response>;
  assert.equal((await get()).status, 401); assert.equal(calls, 0);
  viewer = { id: "signed-in" };
  const response = await get(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.calls, 5); assert.equal("limits" in body, false);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  failure = true; assert.equal((await get()).status, 503);
});

test("reservation configuration errors explain repair steps and never call the provider", async () => {
  for (const [code, message, expected] of [
    ["P0001", "Invalid AI reservation", /rebuild and restart/],
    ["PGRST202", "private database details", /budget migrations/],
    ["42501", "private database details", /Unable to verify/],
  ] as const) {
    let calls = 0;
    const loaded = load("../lib/ai/budget-server.ts", {
      "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: async () => ({ data: null, error: { code, message } }) }) },
      "./budget.ts": budget, "./budget-fetch.ts": budgetFetch,
    }, async () => Response.json({ data: [{ id: "openai/gpt-5-nano", context_window: 400000, pricing: { input: "0.00000005", output: "0.0000004" } }] }));
    const guarded = (loaded.budgetedAiFetch as (owner: string, fetcher: typeof fetch) => typeof fetch)("trusted", async () => { calls++; return Response.json({}); });
    await assert.rejects(guarded("https://ai-gateway.vercel.sh/v1/responses", { body: JSON.stringify({ model: "openai/gpt-5-nano", input: "Hello", max_output_tokens: 100 }) }), (error: Error) => {
      assert.equal(error.name, "AiBudgetError");
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /private database/);
      return true;
    });
    assert.equal(calls, 0);
  }
});
test("generation ignores the legacy budget flag and still reports token usage", async () => {
  const previous = process.env.AI_BUDGET_ENFORCEMENT;
  process.env.AI_BUDGET_ENFORCEMENT = "true";
  let calls = 0;
  const common = { systemInstruction: "test", prompt: "Hello" };
  const usage: unknown[] = [];
  try {
    assert.equal(await generateGatewayText({ ...common, token: "synthetic", onUsage: value => usage.push(value), fetcher: async () => {
      calls++; return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Gateway response" }] }], usage: { input_tokens: 10, output_tokens: 5 } });
    } }), "Gateway response");
    assert.equal(await generateGeminiText({ ...common, apiKey: "synthetic", onUsage: value => usage.push(value), fetcher: async () => {
      calls++; return Response.json({ candidates: [{ content: { parts: [{ text: "Gemini response" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
    } }), "Gemini response");
    assert.equal(calls, 2); assert.equal(usage.length, 2);
  } finally { if (previous === undefined) delete process.env.AI_BUDGET_ENFORCEMENT; else process.env.AI_BUDGET_ENFORCEMENT = previous; }
});
test("usage bars render accessible 0-100 values and daily reset information", () => {
  const loaded = load("../components/ai-usage-panel.tsx", {});
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const meter = budget.budgetMeter(50000, 200000, "2026-11-04T16:00:00Z");
  const markup = renderToStaticMarkup(createElement(loaded.AiUsagePanel, { limits: { timezone: "Asia/Shanghai", members: 5, daily: meter, monthly: budget.budgetMeter(30000000, 30000000, "reset"), workspaceDaily: meter } }));
  assert.match(markup, /aria-valuenow="25"/); assert.match(markup, /aria-valuenow="100"/);
  assert.match(markup, /midnight China time/); assert.match(markup, /AI allowance reached/);
  assert.match(markup, /aria-label="Workspace daily AI usage"/);
  assert.match(markup, /Workspace monthly AI allowance reached/);
});

test("usage panels explain paused accounts, zero caps and exhausted workspace daily allowance independently", () => {
  const loaded = load("../components/ai-usage-panel.tsx", {});
  const { renderToStaticMarkup } = require("react-dom/server");
  const { createElement } = require("react");
  const meter = budget.budgetMeter(0, 200000, "reset");
  const limits = { timezone: "Asia/Shanghai", members: 5, daily: meter, workspaceDaily: budget.budgetMeter(200000, 200000, "reset"), monthly: meter, enabled: true };
  const render = () => renderToStaticMarkup(createElement(loaded.AiUsagePanel, { limits }));
  assert.match(render(), /Workspace daily AI allowance reached/);
  limits.workspaceDaily = budget.budgetMeter(0, 0, "reset");
  assert.match(render(), /paused by a zero allowance/);
  assert.doesNotMatch(render(), /Please wait|allowance reached/);
  limits.enabled = false;
  assert.match(render(), /paused for your account/);
  assert.doesNotMatch(render(), /paused by a zero allowance|allowance reached/);
});

test("a denied reservation reads the trusted member's balance to distinguish insufficient credit", async () => {
  const calls: string[] = [];
  const meter = budget.budgetMeter(168000, 200000, "reset");
  const limits = { timezone: "Asia/Shanghai", members: 5, daily: meter, workspaceDaily: meter, monthly: meter };
  const loaded = load("../lib/ai/budget-server.ts", {
    "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name); assert.equal(args.p_user_id, "trusted");
      return { data: name === "reserve_ai_budget" ? { allowed: false, reason: "user_daily" } : limits, error: null };
    } }) }, "./budget.ts": budget, "./budget-fetch.ts": budgetFetch,
  }, async () => Response.json({ data: [{ id: "openai/gpt-5-nano", context_window: 400000, pricing: { input: "0.00000005", output: "0.0000004" } }] }));
  const guarded = (loaded.budgetedAiFetch as (owner: string, fetcher: typeof fetch) => typeof fetch)("trusted", async () => { throw new Error("Must not call provider"); });
  await assert.rejects(guarded("https://ai-gateway.vercel.sh/v1/responses", { body: JSON.stringify({ model: "openai/gpt-5-nano", input: "Hello", max_output_tokens: 100 }) }), /remaining daily AI allowance is too low/);
  assert.deepEqual(calls, ["reserve_ai_budget", "read_ai_budget"]);
});

