import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { defaultAiPolicy } from "../lib/ai-policy.ts";
import * as summaries from "../lib/ai/email-summary.ts";
import * as catalog from "../lib/ai/email-summary-products.ts";
import { aiLanguageSchema } from "../lib/ai/language.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import { policyTestDependency } from "./helpers/ai-policy.ts";

const code = ts.transpileModule(readFileSync(new URL("../app/api/email/assist/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const product = { ...b2bProducts.find(product => product.sku === "PETG-CF")!, imageUrl: "https://cdn.example.com/petg-cf.jpg" };
const brief = { title: "Shopify lead — material inquiry", summary: "Wilson requests PETG-CF in volumes under 50 kg monthly.", nextStep: "Confirm colors and quantity before quoting.", followUpAt: null, followUpReason: "No explicit commitment.", productSkus: ["PETG-CF", "INVENTED"] };

for (const provider of ["gemini", "gateway", "fallback"] as const) {
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
        "@/lib/ai/gemini": { generateGeminiText: provider === "fallback" ? async () => { throw new Error("Region unavailable"); } : generate },
        "@/lib/ai/gateway": { generateGatewayText: generate, isGeminiRegionError: () => true },
        "@/lib/ai/email-rewrite": { normalizeSignatureName: () => "Sales" },
        "@/lib/ai/email-summary": summaries,
        "@/lib/ai/email-summary-products": catalog,
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
      vm.runInNewContext(code, { exports, Response, process: { env: provider === "gateway"
        ? { AI_GATEWAY_API_KEY: "test" } : { GEMINI_API_KEY: "test", AI_GATEWAY_API_KEY: "test" } },
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
      assert.equal(result.provider, provider === "gemini" ? "gemini" : "vercel-ai-gateway");
      const summary = summaries.parseEmailSummary(result.output);
      const prompt = JSON.parse(calls[0].prompt);
      assert.equal(prompt.messageSource, "shopify");
      assert.equal(prompt.subject, "B2B material inquiry");
      assert.ok(!calls[0].prompt.includes("Untrusted client product"));
      assert.equal(calls.length, 1);
      assert.equal(catalogReads, catalogState === "disabled" ? 0 : 1);
      if (catalogState === "available") {
        assert.deepEqual(summary.products, [{ sku: product.sku, title: product.name, imageUrl: product.imageUrl }]);
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
