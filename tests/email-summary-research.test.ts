import assert from "node:assert/strict";
import test from "node:test";
import { attachSummaryResearch, loadSummaryResearch } from "../lib/ai/email-summary-research.ts";
import { attachSummaryProducts } from "../lib/ai/email-summary-products.ts";
import { parseEmailSummary } from "../lib/ai/email-summary.ts";
import type { CustomerResearch } from "../lib/ai/customer-research.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const research: CustomerResearch = { status: "complete", checkedAt: "2026-11-09T01:00:00Z", findings: "Verified business sells 3D printers.", queries: [],
  sources: [{ id: "W1", label: "Business website", url: "https://filament-shop.com/about", recordedAt: "2026-11-09T01:00:00Z" }],
};
const brief = { title: "Filament reseller", summary: "Explore a small starter assortment.", keyPoints: ["Under 50 kg monthly."],
  nextStep: "Ask which materials their customers buy.", followUpAt: null, followUpReason: "No commitment yet.",
  productSkus: ["PETG-BASIC"],
  companyFindings: [{ text: "Sells 3D printers.", sourceIds: ["W1", "FAKE"] }, { text: "Invented revenue.", sourceIds: ["FAKE"] }],
  productRecommendations: [{ sku: "PETG-BASIC", reason: "Possible addition to its printer assortment.", basis: "opportunity", sourceIds: ["W1"] }],
};

test("disabled research and unknown companies never contact a provider", async () => {
  const forbidden = async () => { throw new Error("Must not research"); };
  assert.equal((await loadSummaryResearch({ allowed: false, identity: { name: "Buyer" }, research: forbidden })).status, "disabled");
  for (const name of [undefined, "", "Unknown company", "Customer"]) {
    assert.equal((await loadSummaryResearch({ allowed: true, identity: { name, email: "someone@hotmail.com" }, research: forbidden })).status, "no_identity");
  }
});

test("research errors preserve the conversation brief; unsafe sources are removed", async () => {
  const identity = { name: "Filament Shop", website: "https://filament-shop.com" };
  assert.equal((await loadSummaryResearch({ allowed: true, identity, research: async () => { throw new Error("Timeout"); } })).status, "unavailable");
  const result = await loadSummaryResearch({ allowed: true, identity, research: async received => {
    assert.deepEqual(received, identity);
    return { ...research, sources: [...research.sources, { ...research.sources[0], id: "W2", url: "javascript:alert(1)" }] };
  } });
  assert.deepEqual(result.sources, research.sources);
});

test("findings and inferred offers retain only actual research source IDs and server catalog products", () => {
  const product = b2bProducts.find(product => product.sku === "PETG-BASIC")!;
  const catalog = { status: "available" as const, products: [product] };
  const result = parseEmailSummary(attachSummaryResearch(attachSummaryProducts(JSON.stringify(brief), catalog), research));
  assert.deepEqual(result.companyFindings, [{ text: "Sells 3D printers.", sourceIds: ["W1"] }]);
  assert.equal(result.products?.[0].title, product.name);
  assert.equal(result.productRecommendations?.[0].basis, "opportunity");
  assert.equal(result.research?.sources[0].url, research.sources[0].url);
  assert.deepEqual(result.keyPoints, brief.keyPoints);
});

test("unverified opportunities cannot survive as product cards when research fails", () => {
  const product = b2bProducts.find(product => product.sku === "PETG-BASIC")!;
  const output = attachSummaryProducts(JSON.stringify(brief), { status: "available", products: [product] });
  for (const status of ["unavailable", "no_results", "disabled"] as const) {
    const result = parseEmailSummary(attachSummaryResearch(output, { ...research, status }));
    assert.deepEqual(result.companyFindings, []);
    assert.deepEqual(result.products, []);
    assert.deepEqual(result.productSkus, []);
    assert.deepEqual(result.productRecommendations, []);
    assert.deepEqual(result.research?.sources, []);
    assert.equal(result.productMatchStatus, "no_match");
    assert.equal(result.summary, brief.summary);
  }
});

test("explicit customer requests remain valid without public research", () => {
  const product = b2bProducts.find(product => product.sku === "PETG-BASIC")!;
  const output = attachSummaryProducts(JSON.stringify({ ...brief,
    productRecommendations: [{ sku: product.sku, reason: "Customer asked for PETG.", basis: "requested", sourceIds: [] }],
  }), { status: "available", products: [product] });
  const result = parseEmailSummary(attachSummaryResearch(output, { ...research, status: "unavailable" }));
  assert.deepEqual(result.productSkus, [product.sku]);
  assert.equal(result.productRecommendations?.[0].basis, "requested");
});
