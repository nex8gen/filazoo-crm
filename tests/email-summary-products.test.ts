import assert from "node:assert/strict";
import test from "node:test";
import { attachSummaryProducts, loadSummaryCatalog, summaryProductContext } from "../lib/ai/email-summary-products.ts";
import { emailSummaryInstruction, parseEmailSummary } from "../lib/ai/email-summary.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const products = ["PETG-BASIC", "PETG-CF", "PETG-MATTE"].map(sku => ({
  ...b2bProducts.find(product => product.sku === sku)!,
  imageUrl: `https://cdn.example.com/${sku}.jpg`,
}));
const brief = { title: "Shopify material inquiry", summary: "Wilson is interested in PETG and PETG-CF, under 50 kg monthly.", nextStep: "Confirm colors and order quantity before quoting.", followUpAt: null, followUpReason: "No further action.", productSkus: ["PETG-BASIC", "PETG-CF"] };

test("product cards use exact live catalog titles and images, never AI display metadata", () => {
  const output = attachSummaryProducts(JSON.stringify({ ...brief,
    products: [{ sku: "PETG-BASIC", title: "Invented title", imageUrl: "https://evil.example/image.jpg" }],
  }), { status: "available", products });
  const result = parseEmailSummary(output);
  assert.deepEqual(result.products, products.slice(0, 2).map(product => ({ sku: product.sku, title: product.name, imageUrl: product.imageUrl })));
  assert.equal(result.productMatchStatus, "matched");
  assert.equal(result.summary, brief.summary);
});

test("unknown, duplicate and inactive SKUs cannot become product cards or expand to other grades", () => {
  const output = attachSummaryProducts(JSON.stringify({ ...brief, productSkus: ["PETG-CF", "PETG-CF", "FAKE", "PETG-MATTE"] }), {
    status: "available", products: products.map(product => product.sku === "PETG-MATTE" ? { ...product, status: "Inactive" } : product),
  });
  const result = parseEmailSummary(output);
  assert.deepEqual(result.productSkus, ["PETG-CF"]);
  assert.equal(result.products?.length, 1);
});

test("catalog access denial never loads or leaks product records", async () => {
  const catalog = await loadSummaryCatalog(false, async () => { throw new Error("Must not load"); });
  assert.deepEqual(summaryProductContext(catalog), { status: "disabled", products: [] });
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { ...catalog, products }));
  assert.deepEqual(result.products, []);
  assert.equal(result.productMatchStatus, "disabled");
});

test("catalog errors and demo records preserve the summary without fabricated matches", async () => {
  for (const load of [async () => { throw new Error("Database unavailable"); }, async () => ({ mode: "demo", products })]) {
    const catalog = await loadSummaryCatalog(true, load);
    const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), catalog));
    assert.equal(result.summary, brief.summary);
    assert.equal(result.productMatchStatus, "unavailable");
    assert.deepEqual(result.products, []);
  }
});

test("missing and unsafe images use an honest fallback; catalog context omits prices", async () => {
  const catalog = await loadSummaryCatalog(true, async () => ({ mode: "live", products: [
    { ...products[0], imageUrl: null }, { ...products[1], imageUrl: "javascript:alert(1)" },
    { ...products[2], status: "Inactive" },
  ] }));
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), catalog));
  assert.ok(result.products?.every(product => product.imageUrl === null));
  const context = summaryProductContext(catalog);
  assert.equal(context.products.length, 2);
  assert.ok(context.products.every(product => !("price" in product) && !("imageUrl" in product)));
});

test("empty and legacy selections remain compatible without guessed cards", () => {
  for (const productSkus of [undefined, [], ["MISSING"]]) {
    const result = parseEmailSummary(attachSummaryProducts(JSON.stringify({ ...brief, productSkus }), { status: "available", products }));
    assert.equal(result.productMatchStatus, "no_match");
    assert.deepEqual(result.products, []);
  }
  assert.throws(() => parseEmailSummary(JSON.stringify({ ...brief, productSkus: Array(7).fill("PETG-CF") })));
});

test("analysis guidance identifies Shopify buyers and preserves product grade distinctions", () => {
  assert.match(emailSummaryInstruction, /Shopify contact-form buyer inquiry/);
  assert.match(emailSummaryInstruction, /Keep PETG distinct from PETG-CF/);
  assert.match(emailSummaryInstruction, /ask to confirm the grade or finish instead of guessing/);
});
