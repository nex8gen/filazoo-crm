import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { defaultAiPolicy } from "../lib/ai-policy.ts";
import * as summaries from "../lib/ai/email-summary.ts";
import * as catalog from "../lib/ai/email-summary-products.ts";
import * as summaryResearch from "../lib/ai/email-summary-research.ts";
import * as summaryCache from "../lib/ai/email-summary-cache.ts";
import * as summaryMatching from "../lib/ai/email-summary-matching.ts";
import { aiLanguageSchema } from "../lib/ai/language.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import { policyTestDependency } from "./helpers/ai-policy.ts";

test("reopening an email reuses AI and research while refreshing live prices; explicit refresh regenerates", async () => {
  const policy = defaultAiPolicy();
  const saved = new Map<string, { output: string; generatedAt: string; cached: boolean }>();
  let aiCalls = 0, researchCalls = 0, policyReads = 0;
  let price = "$12.00";
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "member", role: "admin", workspaceId: "workspace", displayName: "Sales" }) },
    "@/lib/data/ai-settings": { requireAiFeature: async () => { policyReads++; return policy; } },
    "@/lib/ai/gateway": { generateGatewayText: async () => { aiCalls++; return JSON.stringify(brief); } },
    "@/lib/ai/email-rewrite": { normalizeSignatureName: () => "Sales" },
    "@/lib/ai/email-summary": summaries,
    "@/lib/ai/email-summary-products": catalog,
    "@/lib/ai/email-summary-research": summaryResearch,
    "@/lib/ai/email-summary-cache": summaryCache,
    "@/lib/ai/email-summary-matching": summaryMatching,
    "@/lib/data/email-summary-cache": { savedEmailSummary: async (viewer: { id: string; workspaceId: string }, key: string, generate: () => Promise<string>, refresh: boolean) => {
      key = `${viewer.workspaceId}:${viewer.id}:${key}`;
      if (!refresh && saved.has(key)) return { ...saved.get(key), cached: true };
      const result = { output: await generate(), generatedAt: new Date().toISOString(), cached: false };
      saved.set(key, result);
      return result;
    } },
    "@/lib/ai/customer-research": { researchCustomer: async () => { researchCalls++; return { status: "no_results", checkedAt: new Date().toISOString(), findings: "", sources: [], queries: [] }; } },
    "@/lib/data/crm": { listProducts: async () => ({ mode: "live", products: b2bProducts.map(saved => saved.sku === product.sku ? { ...product, price } : saved) }) },
    "@/lib/email-translation": {},
    "@/lib/ai/language": { aiLanguageSchema },
    zod: { z },
  };
  const exports = {} as { POST(request: Request): Promise<Response> };
  vm.runInNewContext(code, { exports, Response, AbortSignal, process: { env: { AI_GATEWAY_API_KEY: "test" } }, require: (name: string) => {
    if (name in dependencies) return dependencies[name];
    const dependency = policyTestDependency(name);
    assert.ok(dependency, `Unexpected dependency: ${name}`);
    return dependency;
  } });
  const request = (extra = {}) => exports.POST(new Request("http://localhost/api/email/assist", { method: "POST", body: JSON.stringify({ mode: "summary", text: "Interested in PETG-CF", customerProfile: { companyName: "Print Studio" }, ...extra }) }));
  const first = await (await request()).json();
  assert.equal(first.cached, false);
  price = "$15.00";
  const reopened = await (await request({ currentFollowUpAt: "2026-11-10T01:00:00Z" })).json();
  assert.equal(reopened.cached, true);
  assert.equal(summaries.parseEmailSummary(reopened.output).products?.[0].price, "$15.00");
  assert.equal(aiCalls, 1);
  assert.equal(researchCalls, 1);
  assert.equal(policyReads, 2, "Cached results still require live policy checks");
  assert.equal((await (await request({ refreshSummary: true })).json()).cached, false);
  assert.equal(aiCalls, 2);
  assert.equal(researchCalls, 2);
  policy.features.webSearch = false;
  assert.equal((await (await request()).json()).cached, false);
  assert.equal(aiCalls, 3);
  assert.equal(researchCalls, 2);
  const inquiry = "We'd like to open a wholesale account and resell Filazoo PLA, PLA+, silk PLA, PETG and TPU. Please send your wholesale price list and dropship terms.";
  const key = summaryCache.emailSummaryCacheKey({ mode: "summary", language: "en", text: inquiry, customerProfile: { companyName: "Print Studio" } }, policy, "admin");
  saved.set(`workspace:member:${key}`, { output: JSON.stringify({ ...brief, productSkus: ["PLA-BASIC", "PETG-BASIC"] }), generatedAt: "2026-11-09T01:00:00Z", cached: false });
  const repaired = await (await request({ text: inquiry, messageDirection: "inbound" })).json();
  assert.equal(repaired.cached, true, "Repair existing briefs instead of invalidating the cache");
  const matches = summaries.parseEmailSummary(repaired.output);
  assert.deepEqual([...matches.productSkus!].sort(), ["PETG-BASIC", "PLA-BASIC", "PLA-SILK-BASIC"]);
  assert.deepEqual(matches.unresolvedProducts, [{ term: "PLA Plus", reason: "not_found" }, { term: "TPU", reason: "ambiguous" }]);
  assert.equal(aiCalls, 3, "Cached product correction must not buy an AI request");
  assert.equal(researchCalls, 2, "Cached product correction must not buy another web search");
});

const code = ts.transpileModule(readFileSync(new URL("../app/api/email/assist/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const product = { ...b2bProducts.find(product => product.sku === "PETG-CF")!, imageUrl: "https://cdn.example.com/petg-cf.jpg" };
const brief = { title: "Shopify lead — material inquiry", summary: "Wilson requests PETG-CF in volumes under 50 kg monthly.", nextStep: "Confirm colors and quantity before quoting.", followUpAt: null, followUpReason: "No explicit commitment.", productSkus: ["PETG-CF", "INVENTED"] };

test("saved conversation analyses survive reloads and replies only update the next step", async () => {
  const policy = defaultAiPolicy();
  const records = new Map<string, { output: string; generatedAt: string }>();
  let aiCalls = 0, researchCalls = 0, catalogReads = 0;
  const nextSteps = ["Wait for the buyer to confirm colors.", "Send the quote for black PETG-CF."];
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "member", role: "admin", workspaceId: "workspace" }) },
    "@/lib/data/ai-settings": { requireAiFeature: async () => policy },
    "@/lib/ai/gateway": { generateGatewayText: async (input: { prompt: string; systemInstruction: string }) => {
      aiCalls++;
      const prompt = JSON.parse(input.prompt);
      if (!prompt.savedAnalysis) return JSON.stringify(brief);
      assert.match(input.systemInstruction, /only the suggested next sales step/);
      assert.equal(prompt.WEB_RESEARCH, undefined);
      assert.equal(prompt.productCatalog, undefined);
      assert.equal(prompt.savedAnalysis.summary, brief.summary);
      return JSON.stringify({ nextStep: nextSteps[aiCalls - 2], followUpAt: null, followUpReason: "Conversation changed.", summary: "Must not replace the analysis" });
    } },
    "@/lib/ai/email-rewrite": { normalizeSignatureName: () => "Sales" },
    "@/lib/ai/email-summary": summaries,
    "@/lib/ai/email-summary-cache": summaryCache,
    "@/lib/ai/email-summary-products": catalog,
    "@/lib/ai/email-summary-research": summaryResearch,
    "@/lib/ai/email-summary-matching": summaryMatching,
    "@/lib/data/email-summary-cache": { savedEmailSummary: async (_viewer: unknown, key: string, generate: () => Promise<string>, refresh: boolean, update: summaryCache.EmailSummaryUpdate) => {
      const store: summaryCache.EmailSummaryStore = {
        read: async () => records.get(key) ?? null,
        claim: async () => true,
        complete: async (_token, output, generatedAt) => { records.set(key, { output, generatedAt }); },
        release: async () => {},
      };
      return summaryCache.reuseEmailSummary(store, "test-lease", generate, refresh, update);
    } },
    "@/lib/ai/customer-research": { researchCustomer: async () => { researchCalls++; return { status: "no_results", sources: [], findings: "", queries: [] }; } },
    "@/lib/data/crm": { listProducts: async () => { catalogReads++; return { mode: "live", products: [product] }; } },
    "@/lib/email-translation": {},
    "@/lib/ai/language": { aiLanguageSchema },
    zod: { z },
  };
  const exports = {} as { POST(request: Request): Promise<Response> };
  vm.runInNewContext(code, { exports, Response, AbortSignal, process: { env: { AI_GATEWAY_API_KEY: "test" } }, require: (name: string) => {
    if (name in dependencies) return dependencies[name];
    const dependency = policyTestDependency(name);
    assert.ok(dependency, `Unexpected dependency: ${name}`);
    return dependency;
  } });
  const request = async (extra = {}) => {
    const response = await exports.POST(new Request("http://localhost/api/email/assist", { method: "POST", body: JSON.stringify({
      mode: "summary", conversationId: "root-message", mailboxId: "sales", messageId: "inquiry", messageTimestamp: "2026-11-09T01:00:00Z",
      text: "Interested in PETG-CF", customerProfile: { companyName: "Print Studio" }, ...extra,
    }) }));
    assert.equal(response.status, 200);
    return response.json();
  };
  const first = await request();
  const original = summaries.parseEmailSummary(first.output);
  assert.equal(first.cached, false);
  const reopened = await request({ customerProfile: { companyName: "Edited profile" }, language: "zh-CN", currentFollowUpAt: "2026-11-12T01:00:00Z", refreshSummary: true });
  assert.equal(reopened.cached, true);
  assert.deepEqual(summaries.parseEmailSummary(reopened.output), original);
  assert.equal(aiCalls, 1);
  const outbound = { messageId: "sales-reply", messageTimestamp: "2026-11-09T02:00:00Z", messageDirection: "outbound", text: "Please confirm colors." };
  const sent = await request(outbound);
  assert.equal(sent.cached, false);
  assert.deepEqual(summaries.parseEmailSummary(sent.output), { ...original, nextStep: nextSteps[0], followUpReason: "Conversation changed." });
  assert.equal((await request(outbound)).cached, true);
  const inbound = await request({ messageId: "buyer-reply", messageTimestamp: "2026-11-09T03:00:00Z", messageDirection: "inbound", text: "Please quote 20 kg black PETG-CF." });
  assert.deepEqual(summaries.parseEmailSummary(inbound.output), { ...original, nextStep: nextSteps[1], followUpReason: "Conversation changed." });
  assert.equal(aiCalls, 3);
  assert.equal(researchCalls, 1);
  assert.equal(catalogReads, 1);
  assert.equal(records.size, 1, "Replies update the same saved conversation record");
});

for (const provider of ["gateway", "oidc", "legacy-budget"] as const) {
  for (const catalogState of ["available", "disabled", "failed"] as const) {
    test(`${provider} summary resolves verified product cards with ${catalogState} catalog`, async () => {
      const policy = defaultAiPolicy();
      policy.data.products = catalogState !== "disabled";
      let catalogReads = 0;
      const calls: { prompt: string; systemInstruction: string }[] = [];
      const generate = async (input: { prompt: string; systemInstruction: string }) => {
        calls.push(input);
        return JSON.stringify(brief);
      };
      const dependencies: Record<string, unknown> = {
        "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "member", displayName: "Sales" }) },
        "@/lib/data/ai-settings": { requireAiFeature: async () => policy },
        "@/lib/ai/gateway": { generateGatewayText: generate, },
        "@/lib/ai/email-rewrite": { normalizeSignatureName: () => "Sales" },
        "@/lib/ai/email-summary": summaries,
        "@/lib/ai/email-summary-cache": summaryCache,
        "@/lib/ai/email-summary-matching": summaryMatching,
        "@/lib/data/email-summary-cache": { savedEmailSummary: async (_viewer: unknown, _key: string, generate: () => Promise<string>) => ({ output: await generate(), generatedAt: new Date().toISOString(), cached: false }) },
        "@/lib/ai/email-summary-products": catalog,
        "@/lib/ai/email-summary-research": summaryResearch,
        "@/lib/ai/customer-research": { researchCustomer: async () => { throw new Error("No identity to research"); } },
        "@/lib/email-translation": {},
        "@/lib/ai/language": { aiLanguageSchema },
        "@/lib/data/crm": { listProducts: async (_skus: unknown, options: { requireComplete: boolean }) => {
          catalogReads++;
          assert.equal(options.requireComplete, true);
          if (catalogState === "failed") throw new Error("Catalog offline");
          return { mode: "live", products: [product] };
        } },
        zod: { z },
      };
      const exports = {} as { POST(request: Request): Promise<Response> };
      vm.runInNewContext(code, { exports, Response, AbortSignal, process: { env: provider === "oidc" ? { VERCEL_OIDC_TOKEN: "test-oidc" } : { AI_GATEWAY_API_KEY: "test", ...(provider === "legacy-budget" ? { AI_BUDGET_ENFORCEMENT: "true" } : {}) } },
        require: (name: string) => {
          if (name in dependencies) return dependencies[name];
          const dependency = policyTestDependency(name);
          assert.ok(dependency, `Unexpected dependency: ${name}`);
          return dependency;
        },
      });
      const response = await exports.POST(new Request("http://localhost/api/email/assist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "summary", language: "en", messageSource: "shopify", subject: "B2B material inquiry", text: "Interested in PETG-CF, under 50 kg monthly.",
          products: [{ sku: "INVENTED", title: "Untrusted client product" }],
        }),
      }));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.provider, "vercel-ai-gateway");
      const summary = summaries.parseEmailSummary(result.output);
      const prompt = JSON.parse(calls[0].prompt);
      assert.equal(prompt.messageSource, "shopify");
      assert.equal(prompt.subject, "B2B material inquiry");
      assert.ok(!calls[0].prompt.includes("Untrusted client product"));
      assert.equal(calls.length, 1);
      assert.equal(catalogReads, catalogState === "disabled" ? 0 : 1);
      if (catalogState === "available") {
        assert.deepEqual(summary.products, [{ sku: product.sku, title: product.name, imageUrl: product.imageUrl, price: product.price }]);
        assert.deepEqual(summary.productSkus, [product.sku]);
        assert.equal(prompt.productCatalog.products[0].sku, product.sku);
      } else {
        assert.deepEqual(summary.products, []);
        assert.deepEqual(prompt.productCatalog.products, []);
        assert.equal(summary.productMatchStatus, catalogState === "disabled" ? "disabled" : "unavailable");
      }
    });
  }
}

for (const scenario of ["complete", "outage", "web-disabled", "customers-disabled"] as const) {
  test(`summary company research: ${scenario}`, async () => {
    const policy = defaultAiPolicy();
    policy.features.webSearch = scenario !== "web-disabled";
    policy.data.customers = scenario !== "customers-disabled";
    let researchCalls = 0;
    let prompt: Record<string, unknown> = {};
    const dependencies: Record<string, unknown> = {
      "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "member", displayName: "Sales" }) },
      "@/lib/data/ai-settings": { requireAiFeature: async () => policy },
      "@/lib/ai/gateway": { generateGatewayText: async (input: { prompt: string }) => {
        prompt = JSON.parse(input.prompt);
        return JSON.stringify({ ...brief, productSkus: [product.sku],
          companyFindings: [{ text: "Runs a prototyping service.", sourceIds: ["W1"] }],
          productRecommendations: [{ sku: product.sku, reason: "Potential fit for functional prototypes.", basis: "opportunity", sourceIds: ["W1"] }],
        });
      } },
      "@/lib/ai/email-rewrite": { normalizeSignatureName: () => "Sales" },
      "@/lib/ai/email-summary": summaries,
      "@/lib/ai/email-summary-cache": summaryCache,
      "@/lib/ai/email-summary-matching": summaryMatching,
      "@/lib/data/email-summary-cache": { savedEmailSummary: async (_viewer: unknown, _key: string, generate: () => Promise<string>) => ({ output: await generate(), generatedAt: new Date().toISOString(), cached: false }) },
      "@/lib/ai/email-summary-products": catalog,
      "@/lib/ai/email-summary-research": summaryResearch,
      "@/lib/ai/customer-research": { researchCustomer: async (input: { identity: Record<string, unknown>; signal: AbortSignal; usageUserId: string }) => {
        researchCalls++;
        assert.deepEqual(JSON.parse(JSON.stringify(input.identity)), { name: "Print Studio", website: "https://print-studio.com", country: "Chile" });
        assert.ok(input.signal instanceof AbortSignal);
        assert.equal(input.usageUserId, "member");
        assert.ok(!JSON.stringify(input).includes("Private CRM note"));
        assert.ok(!JSON.stringify(input).includes("Private email body"));
        if (scenario === "outage") throw new Error("Provider unavailable");
        return { status: "complete", checkedAt: "2026-11-09T01:00:00Z", findings: "Runs a prototyping service.", queries: [],
          sources: [{ id: "W1", label: "Services", url: "https://print-studio.com/services", recordedAt: "2026-11-09T01:00:00Z" }] };
      } },
      "@/lib/email-translation": {},
      "@/lib/ai/language": { aiLanguageSchema },
      "@/lib/data/crm": { listProducts: async () => ({ mode: "live", products: [product] }) },
      zod: { z },
    };
    const exports = {} as { POST(request: Request): Promise<Response> };
    vm.runInNewContext(code, { exports, Response, AbortSignal, process: { env: { AI_GATEWAY_API_KEY: "test" } },
      require: (name: string) => {
        if (name in dependencies) return dependencies[name];
        const dependency = policyTestDependency(name);
        assert.ok(dependency, `Unexpected dependency: ${name}`);
        return dependency;
      },
    });
    const response = await exports.POST(new Request("http://localhost/api/email/assist", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "summary", text: "Private email body",
        customerProfile: { companyName: "Print Studio", website: "https://print-studio.com", country: "Chile", summary: "Private CRM note" },
      }),
    }));
    assert.equal(response.status, 200);
    const result = summaries.parseEmailSummary((await response.json()).output);
    assert.equal(researchCalls, scenario.endsWith("disabled") ? 0 : 1);
    assert.equal(result.research?.status, scenario === "outage" ? "unavailable" : scenario.endsWith("disabled") ? "disabled" : "complete");
    if (scenario === "customers-disabled") assert.equal(prompt.customerProfile, undefined);
    if (scenario === "complete") {
      assert.equal(result.companyFindings?.length, 1);
      assert.equal(result.products?.[0].sku, product.sku);
      assert.equal(result.productRecommendations?.[0].basis, "opportunity");
      assert.equal(result.research?.sources[0].url, "https://print-studio.com/services");
    } else {
      assert.deepEqual(result.companyFindings, []);
      assert.deepEqual(result.products, []);
      assert.equal(result.summary, brief.summary);
    }
  });
}
