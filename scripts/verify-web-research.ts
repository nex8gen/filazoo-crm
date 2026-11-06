import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { researchWithGateway, GOOGLE_WEB_RESEARCH_MODEL } from "../lib/ai/gateway-research.ts";
import { evaluationBudget, atomicEvaluationJson } from "../lib/ai/evaluation-budget.ts";
import { generateText } from "ai";

if (!process.argv.includes("--live")) { console.log(JSON.stringify({ model: GOOGLE_WEB_RESEARCH_MODEL, maximumCalls: 3, reservedPerCallUsd: .25, usesExistingFiveDollarTestLedger: true })); process.exit(0); }
const directory = resolve("tmp/agent-soak-20261105"), lock = resolve(directory, "worker.lock");
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid evaluation owner.");
  try { process.kill(pid, 0); throw new Error("Stop the running evaluation worker before sharing its ledger."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  unlinkSync(lock);
}
const descriptor = openSync(lock, "wx"); writeFileSync(descriptor, String(process.pid)); closeSync(descriptor);
try {
  const budget = evaluationBudget(resolve(directory, "budget.json"));
  const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15000) });
  const catalog = await response.json();
  const model = catalog.data?.find((item: { id: string }) => item.id === GOOGLE_WEB_RESEARCH_MODEL);
  if (!response.ok || !model) throw new Error("Current research pricing is unavailable.");
  const variants = [model.pricing, ...Object.values(model.pricing.regional ?? {}), ...Object.values(model.pricing.service_tiers ?? {})] as Array<{ input: string; output: string }>;
  const maximumInput = Math.max(...variants.map(rate => Number(rate.input))), maximumOutput = Math.max(...variants.map(rate => Number(rate.output)));
  // The model catalog quotes web_search per 1,000 grounded requests.
  const maximumCallUsd = model.context_window * maximumInput + 2800 * maximumOutput + Number(model.pricing.web_search) / 1000;
  if (!Number.isFinite(maximumCallUsd) || maximumCallUsd > .25) throw new Error("Research call cannot fit its conservative fixed envelope.");
  let calls = 0;
  const transport: Array<Record<string, unknown>> = [];
  const guarded: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    if (url.origin === "https://vertexaisearch.cloud.google.com" && url.pathname.startsWith("/grounding-api-redirect/") && init?.method === "GET" && init.redirect === "manual") return fetch(input, init);
    const body = JSON.parse(String(init?.body));
    const tools = body.tools as Array<{ id?: string }>;
    if (url.origin !== "https://ai-gateway.vercel.sh" || !url.pathname.endsWith("/language-model") || init?.method !== "POST" || headers.get("ai-language-model-id") !== GOOGLE_WEB_RESEARCH_MODEL || Number(body.maxOutputTokens) > 2800 || tools.length !== 1 || !["google.google_search", "google.url_context"].includes(tools[0].id ?? "") || calls >= 3) throw new Error("Unexpected live research provider request.");
    calls++;
    const reservation = budget.reserveExternal(250000);
    const result = await fetch(input, { ...init, redirect: "error" });
    const payload = await result.clone().json().catch(() => ({}));
    transport.push({ status: result.status, tools: tools.map(tool => tool.id), finishReason: payload.finishReason, content: payload.content, usage: payload.usage, providerMetadata: payload.providerMetadata, ...(result.ok ? {} : { error: String(payload.error?.message ?? payload.error ?? "Provider failed").replace(/(?:sk-|vck_|eyJ)[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 1200) }) });
    // Count the entire envelope, including page tokens, search fees and unknown
    // billing adjustments. Never release verification credit based on estimates.
    reservation.settle(250000);
    atomicEvaluationJson(resolve("tmp/web-research-transport.json"), transport);
    return result;
  };
  const known = process.argv.includes("--known-company");
  const replay = process.argv.includes("--replay-discovery") ? JSON.parse(readFileSync("tmp/web-research-successful-discovery.json", "utf8")) : undefined;
  let generated = 0;
  const result = await researchWithGateway({ identity: known ? { name: "Vercel", website: "https://vercel.com/", country: "United States" } : { name: "Inovecell", city: "Cachoeirinha", country: "Brazil", contact: "Everton Vaz", ...(process.argv.includes("--crm-lead") ? { email: "kilograma99@gmail.com" } : {}) }, questions: ["Find public company details, website, products and business size."], language: "en", checkedAt: new Date().toISOString(), fetcher: guarded,
    ...(replay ? { generate: async (options: Parameters<typeof generateText>[0]) => ++generated === 1 ? { text: replay.content.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join(""), sources: replay.content.filter((part: { type: string }) => part.type === "source"), providerMetadata: replay.providerMetadata, finishReason: replay.finishReason.unified } : generateText(options) } : {}) });
  mkdirSync("docs/audit-evidence", { recursive: true });
  atomicEvaluationJson(`docs/audit-evidence/google-web-research-${known ? "known-company-" : ""}20261106.json`, { model: GOOGLE_WEB_RESEARCH_MODEL, maximumPublishedCallUsd: maximumCallUsd, calls, discoveryReplayedFromPriorLiveRequest: Boolean(replay), budget: budget.snapshot(), result, scope: replay ? "Page reading verified live using the prior successful live Google discovery response. Public business identity only. No CRM writes or customer messages." : "Public business identity only. No CRM writes or customer messages." });
  console.log(JSON.stringify({ status: result.status, queries: result.queries.length, sources: result.sources.length, pagesRead: result.visitedUrls?.length ?? 0, warning: result.warning, conservativeTotalTestUsd: budget.snapshot().usedMicros / 1e6 }));
  if (result.status !== "complete" || !result.queries.length || !result.visitedUrls?.length) process.exitCode = 1;
} finally { if (readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock); }
