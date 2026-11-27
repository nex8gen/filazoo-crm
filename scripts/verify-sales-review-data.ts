/** Real read-only data-path check. No login changes, model calls, customer writes or transcript saves. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { withWorkspaceViewer } from "../lib/workspace-context.ts";
import * as policy from "../lib/ai-policy.ts";
import { salesReviewRange } from "../lib/ai/sales-review.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";
import * as assistant from "../lib/ai/workspace-assistant.ts";
import * as reviewPolicy from "../lib/ai/sales-review.ts";
import * as progress from "../lib/ai/research-progress.ts";
import * as images from "../lib/ai/image-input.ts";
import * as requestScope from "../lib/ai/request-context.ts";
import * as customerScope from "../lib/ai/customer-access.ts";
import * as customerIntelligence from "../lib/ai/customer-intelligence.ts";
import * as chatHistory from "../lib/ai/chat-history.ts";
import * as providerError from "../lib/ai/assistant-provider-error.ts";
import * as i18n from "../lib/i18n.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { resolveGatewayTokenAsync } from "../lib/ai/provider-credentials.ts";
import { evaluationBudget, evaluationRate } from "../lib/ai/evaluation-budget.ts";
import { EXPERT_AI_MODEL } from "../lib/ai/model-routing.ts";

if (!process.argv.includes("--live")) { console.log(JSON.stringify({ readOnly: true, modelCalls: false, usesProductionReader: true, scope: "An existing administrator membership; not a browser login" })); process.exit(0); }
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL && env.supabaseSecretKey);
const control = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const member = await control.from("workspace_members").select("user_id,role,workspace_id").eq("role", "admin").not("activated_at", "is", null).limit(1).maybeSingle().throwOnError();
assert.ok(member.data, "Need an existing activated administrator membership for a read-only schema check.");
const actor = { id: member.data.user_id, role: member.data.role, workspaceId: member.data.workspace_id ?? "legacy" } as WorkspaceViewer;
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => name === "server-only" ? {} : name in dependencies ? dependencies[name] : assert.fail(`Unexpected dependency ${name}`), AbortSignal, Date, Error, console, Response, Request, URL, crypto, process });
  return exports as T;
}
const settings = load<typeof import("../lib/data/ai-settings.ts")>("lib/data/ai-settings.ts", { "../supabase/admin.ts": { createSupabaseAdmin }, "../env.ts": { hasSupabaseConfig: () => true }, "../ai-policy.ts": policy });
const records = load<typeof import("../lib/ai/sales-review-records.ts")>("lib/ai/sales-review-records.ts", { "../supabase/admin": { createSupabaseAdmin }, "../data/ai-settings": settings });
const period = salesReviewRange("Review the last seven days of accessible sales activity")!;
const started = performance.now();
const result = await withWorkspaceViewer(actor, async () => records.readSalesReview(actor, period, await settings.requireAiData("customers"), AbortSignal.timeout(20000)));
const receipt = { checkedAt: new Date().toISOString(), readOnly: true, modelCalls: false, productionReader: true, browserSessionVerified: false,
  period, elapsedMs: Math.round(performance.now() - started), sources: Object.fromEntries(Object.entries(result.sources).map(([name, source]) => [name, source.coverage])),
  externalMailboxHistoryScanned: result.coverage.externalMailboxHistoryScanned };
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/sales-review-data-20261127.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
assert.ok(Object.values(result.sources).some(source => source.coverage.available), "No enabled source could be read.");

if (process.argv.includes("--model")) {
  const token = await resolveGatewayTokenAsync(); assert.ok(token);
  const prices = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15000) }); assert.ok(prices.ok);
  const catalog = await prices.json() as { data: Array<{ id: string } & Parameters<typeof evaluationRate>[0]> };
  const modelPrice = catalog.data.find(row => row.id === EXPERT_AI_MODEL); assert.ok(modelPrice);
  mkdirSync("output/sales-review-verification", { recursive: true });
  const budget = evaluationBudget("output/sales-review-verification/budget.json"), rate = evaluationRate(modelPrice);
  const metered = budget.fetch(async model => { assert.equal(model, EXPERT_AI_MODEL); return rate; });
  let providerCalls = 0;
  const transport: typeof fetch = async (url, init) => { assert.equal(++providerCalls, 1, "This review should need one generation only"); return metered(url, init); };
  const denied = new Proxy({}, { get: (_target, name) => () => assert.fail(`The weekly review unexpectedly called ${String(name)}`) });
  const source = ts.transpileModule(readFileSync("app/api/ai/assistant/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies: Record<string, unknown> = {
    "@/lib/ai/provider-credentials": { resolveGatewayToken: () => token }, "@/lib/data/ai-settings": settings,
    "@/lib/ai-policy": policy, "@/lib/i18n": i18n, "@/lib/auth": { getWorkspaceViewer: async () => actor },
    "@/lib/workspace-context": { withWorkspaceViewer }, "@/lib/ai/workspace-assistant": assistant,
    "@/lib/ai/gateway": { generateGatewayText: (input: Parameters<typeof generateGatewayText>[0]) => generateGatewayText({ ...input, usageUserId: undefined, fetcher: transport }) },
    "@/lib/ai/assistant-provider-error": providerError, "@/lib/ai/request-context": requestScope,
    "@/lib/ai/research-progress": progress, "@/lib/ai/image-input": images,
    "@/lib/ai/chat-session": { startChatSession: async () => undefined },
    "@/lib/ai/chat-history": chatHistory, "@/lib/ai/chat-history-server": { HistoryError: class extends Error {} },
    "@/lib/ai/customer-intelligence": customerIntelligence, "@/lib/ai/customer-access": customerScope,
    "@/lib/ai/sales-review": reviewPolicy, "@/lib/ai/sales-review-records": records,
  };
  const api = {} as { POST(request: Request): Promise<Response> };
  vm.runInNewContext(source, { exports: api, require: (name: string) => dependencies[name] ?? denied, Response, Request, URL, AbortSignal, Date, Error, crypto, process, console });
  const question = "Review the last seven days of accessible sales activity. Explain what moved forward, where opportunities stalled, and the three changes most likely to improve next week’s work.";
  const began = performance.now();
  const response = await api.POST(new Request("http://localhost:3000/api/ai/assistant", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", accept: progress.researchStreamType }, body: JSON.stringify({ mode: "work", pathname: "/email", pageLabel: "Email", pageText: "UNRELATED_SELECTED_EMAIL_MUST_NOT_BE_USED", pageContext: { emailId: "unrelated-selected-email" }, messages: [{ role: "user", content: question }] }) }));
  const payload = await progress.readResearchResponse<{ output: string; actions: unknown[]; salesReview?: unknown; activity: progress.AssistantActivity[] }>(response, () => {});
  assert.equal(response.status, 200); assert.equal(providerCalls, 1); assert.ok(payload.output.length > 100); assert.equal(payload.actions.length, 0); assert.ok(payload.salesReview);
  assert.deepEqual(payload.activity.map(row => row.label), ["Reviewing request context", "Reviewing sales activity", "Writing sales review"]);
  assert.ok(payload.activity.every(row => row.status === "complete"));
  assert.doesNotMatch(payload.output, /UNRELATED_SELECTED_EMAIL|FILAZOO_.*_JSON:/);
  writeFileSync("output/sales-review-verification/response.json", JSON.stringify(payload, null, 2) + "\n");
  const flowReceipt = { checkedAt: new Date().toISOString(), question, browserSessionVerified: false, authentication: "Existing administrator membership injected into the route for this diagnostic; browser authentication was not tested", data: "Real production reader and database", model: EXPERT_AI_MODEL, providerCalls,
    elapsedMs: Math.round(performance.now() - began), actionsPrepared: payload.actions.length, outputCharacters: payload.output.length,
    activity: payload.activity, writes: "No customer changes, sends, authentication changes or transcript saves; isolated evaluation-spending ledger only" };
  writeFileSync("docs/audit-evidence/sales-review-route-20261127.json", JSON.stringify(flowReceipt, null, 2) + "\n");
  console.log(JSON.stringify(flowReceipt));
}
