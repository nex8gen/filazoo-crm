// Read-only public research + synthetic inquiry. No CRM writes or email sends.
// node --env-file=.env.local --experimental-strip-types scripts/verify-email-sales-brief.ts
// Add --known-evidence to test live generation against a captured public research fixture.
import assert from "node:assert/strict";
import { resolveGatewayToken } from "../lib/ai/provider-credentials.ts";
import { researchCustomer } from "../lib/ai/customer-research.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { buildEmailSummaryInstruction, generateEmailSummary, parseEmailSummary } from "../lib/ai/email-summary.ts";
import { attachSummaryResearch, loadSummaryResearch } from "../lib/ai/email-summary-research.ts";
import { attachSummaryProducts, loadSummaryCatalog, summaryProductContext } from "../lib/ai/email-summary-products.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const token = resolveGatewayToken(process.env);
if (!token) throw new Error("AI Gateway is required for this read-only check.");
const identity = { name: "3DJake", website: "https://www.3djake.com" };
const knownEvidence = process.argv.includes("--known-evidence");
const research = await loadSummaryResearch({ allowed: true, identity,
  research: identity => knownEvidence ? Promise.resolve({ status: "complete" as const, checkedAt: "2026-11-09T01:19:25.987Z",
    findings: "Captured public research fixture: 3DJake is an online retailer of 3D printers, filaments and accessories. Its assortment includes PLA filaments and its own 3DJake brand alongside other brands. Source W1. Reseller purchasing needs and budgets are unverified.",
    queries: [], sources: [{ id: "W1", label: "3DJake", url: "https://www.3djake.com/", recordedAt: "2026-11-09T01:19:25.987Z" }],
  }) : researchCustomer({ identity, questions: ["Verify its products and sales channels, then identify the strongest relevant filament opportunities."], signal: AbortSignal.timeout(35_000) }),
});
console.log(JSON.stringify({ researchMode: knownEvidence ? "captured-fixture" : "live", researchStatus: research.status, sources: research.sources.length }));
const catalog = await loadSummaryCatalog(true, async () => ({ mode: "live", products: b2bProducts }));
const prompt = JSON.stringify({ subject: "Synthetic wholesale inquiry", messageSource: "shopify", customerProfile: { companyName: identity.name, website: identity.website },
  latestMessage: "We are considering a filament supplier. Expected initial volume is under 50 kg monthly. Please suggest a suitable starter assortment.",
  productCatalog: summaryProductContext(catalog), WEB_RESEARCH: research,
});
const generated = await generateEmailSummary(correction => generateGatewayText({ token, task: "email", complex: Boolean(correction),
  systemInstruction: `${buildEmailSummaryInstruction()} CURRENT TIME: ${new Date().toISOString()}`,
  prompt: correction ? `${prompt}\nVALIDATION CORRECTION:\n${correction}` : prompt,
}));
const summary = parseEmailSummary(attachSummaryResearch(attachSummaryProducts(generated, catalog), research));
assert.ok(summary.keyPoints?.length, "The brief must contain scannable buying signals.");
assert.ok(summary.summary.length < 350, "The lead assessment should be concise.");
assert.ok((summary.products ?? []).every(product => b2bProducts.some(saved => saved.sku === product.sku)), "Only real catalog SKUs may be offered.");
const visible = [summary.title, summary.summary, ...(summary.keyPoints ?? []), ...(summary.companyFindings ?? []).map(item => item.text),
  ...(summary.productRecommendations ?? []).map(item => item.reason), summary.nextStep].join(" ");
console.log(JSON.stringify({ visibleWords: visible.split(/\s+/).length, summary }, null, 2));
assert.ok(visible.split(/\s+/).length <= 180, "The sales brief should stay near its 160-word target.");
if (research.status === "complete") {
  assert.ok(summary.companyFindings?.length, "Verified research should produce sourced company findings.");
  assert.ok(summary.productRecommendations?.some(item => item.basis === "opportunity"), "Relevant reseller research should produce a reasoned product opportunity.");
}
