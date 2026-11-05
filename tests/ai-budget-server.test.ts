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
test("usage API authenticates before reading allowance and fails closed when unavailable", async () => {
  let viewer: { id: string } | null = null, calls = 0, failure = false;
  const loaded = load("../app/api/ai/usage/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ rpc: async () => ({ data: {}, error: null }) }) },
    "@/lib/ai/budget-server": { readAiBudget: async (owner: string) => { calls++; assert.equal(owner, "signed-in"); if (failure) throw new Error("Unavailable"); return { daily: { percent: 25 } }; } },
  });
  const get = loaded.GET as () => Promise<Response>;
  assert.equal((await get()).status, 401); assert.equal(calls, 0);
  viewer = { id: "signed-in" };
  const response = await get(); assert.equal(response.status, 200); assert.equal((await response.json()).limits.daily.percent, 25);
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
test("enabled enforcement rejects ownerless generation and direct Gemini before paid calls", async () => {
  const previous = process.env.AI_BUDGET_ENFORCEMENT;
  process.env.AI_BUDGET_ENFORCEMENT = "true";
  let calls = 0;
  const common = { systemInstruction: "test", prompt: "Hello", fetcher: async () => { calls++; return Response.json({}); } };
  try {
    await assert.rejects(generateGatewayText({ ...common, token: "synthetic" }), /linked to an active workspace member/);
    await assert.rejects(generateGeminiText({ ...common, apiKey: "synthetic" }), /Direct Gemini is disabled/);
    assert.equal(calls, 0);
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
});

