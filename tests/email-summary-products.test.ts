import assert from "node:assert/strict";
import test from "node:test";
import { attachSummaryProducts, loadSummaryCatalog, summaryProductContext } from "../lib/ai/email-summary-products.ts";
import { emailSummaryInstruction, parseEmailSummary } from "../lib/ai/email-summary.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const screenshotInquiry = "Hi, we are 3D Near You (3dnearyou.com), an online store in Brooklyn, NY selling 3D printing materials, machines and accessories. We'd like to open a wholesale account and resell Filazoo PLA, PLA+, silk PLA, PETG and TPU. Please send your wholesale price list and tiers, and your DROPSHIP terms: can you ship single spools directly to our customers?";

test("3D Near You inquiry includes every exact match and exposes unsupported or ambiguous grades", () => {
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify({ ...brief, productSkus: ["PLA-BASIC", "PETG-BASIC"] }), { status: "available", products: b2bProducts }, { text: screenshotInquiry, messageDirection: "inbound" }));
  assert.deepEqual([...result.productSkus!].sort(), ["PETG-BASIC", "PLA-BASIC", "PLA-SILK-BASIC"]);
  assert.deepEqual(result.unresolvedProducts, [{ term: "PLA Plus", reason: "not_found" }, { term: "TPU", reason: "ambiguous" }]);
  assert.ok(!result.productSkus?.includes("PLA-PRO"), "PLA+ is not an established alias for PLA Pro");
  assert.ok(!result.productSkus?.some(sku => sku.startsWith("TPU-")), "A broad TPU inquiry must not pick a random hardness");
  assert.ok(result.products?.every(product => product.price && b2bProducts.some(saved => saved.sku === product.sku && saved.name === product.title)));
});

test("exact requests are not shortened to two or six cards", () => {
  const productSkus = ["PLA-BASIC", "PLA-PRO", "PLA-SILK-BASIC", "PETG-BASIC", "PETG-CF", "ABS", "ASA", "PC"];
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify({ ...brief, productSkus: ["ABS", "PC"] }), { status: "available", products: b2bProducts }, { text: `Please quote ${productSkus.join(", ")}.` }));
  assert.deepEqual([...result.productSkus!].sort(), [...productSkus].sort());
  assert.equal(result.products?.length, 8);
  assert.ok(result.productRecommendations?.every(item => item.basis === "requested"));
});

test("qualified PLA requests never fall back to basic PLA or unrelated finishes", () => {
  for (const text of ["Please quote silk PLA", "Please quote PLA silk", "Please quote PLA-SILK-BASIC"]) {
    const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: b2bProducts }, { text }));
    assert.deepEqual(result.productSkus, ["PLA-SILK-BASIC"]);
  }
  for (const text of ["Please quote PLA+", "Please quote PLA Plus", "Please quote plaplus"]) {
    const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: b2bProducts }, { text }));
    assert.deepEqual(result.productSkus, []);
    assert.deepEqual(result.unresolvedProducts, [{ term: "PLA Plus", reason: "not_found" }]);
  }
  const plus = { ...b2bProducts[0], sku: "PLA-PLUS", name: "PLA Plus" };
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: [...b2bProducts, plus] }, { text: "Please quote PLA+" }));
  assert.deepEqual(result.productSkus, ["PLA-PLUS"]);
  assert.deepEqual(result.unresolvedProducts, []);
});

test("TPU hardness and finish must agree with the saved product", () => {
  for (const text of ["TPU 95A glossy", "TPU95A glossy", "TPU 90A/95A glossy"]) {
    const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: b2bProducts }, { text }));
    assert.deepEqual(result.productSkus, ["TPU-90A-95A-GLOSSY"]);
  }
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: b2bProducts }, { text: "Please quote TPU95A" }));
  assert.deepEqual(result.productSkus, []);
  assert.deepEqual(result.unresolvedProducts, [{ term: "TPU 95A", reason: "ambiguous" }]);
});

test("duplicate names, inactive products and denied access cannot create guessed matches", () => {
  const catalog = [...b2bProducts, { ...b2bProducts[0], sku: "OTHER-PLA", name: "Basic PLA" }];
  const duplicate = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: catalog }, { text: "Please quote Basic PLA" }));
  assert.deepEqual(duplicate.productSkus, []);
  assert.deepEqual(duplicate.unresolvedProducts, [{ term: "BASIC PLA", reason: "ambiguous" }]);
  for (const status of ["unavailable", "disabled"] as const) {
    const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status, products: b2bProducts }, { text: screenshotInquiry }));
    assert.deepEqual(result.products, []);
    assert.deepEqual(result.unresolvedProducts, []);
  }
  const inactive = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: b2bProducts.map(product => product.sku === "PLA-SILK-BASIC" ? { ...product, status: "Inactive" } : product) }, { text: "Please quote silk PLA" }));
  assert.deepEqual(inactive.products, []);
  assert.deepEqual(inactive.unresolvedProducts, [{ term: "PLA SILK", reason: "ambiguous" }]);
});

test("outbound offers and quoted old requests do not become customer requirements", () => {
  const inquiry = { text: "We can also offer PLA-CF and PETG.", messageDirection: "outbound" as const, conversationHistory: [
    { direction: "inbound" as const, body: "Please quote ABS.\n\nOn Monday, Buyer wrote:\n> Please quote PC and PETG-CF." },
    { direction: "outbound" as const, body: "We can also offer PLA-CF and PETG." },
  ] };
  const result = parseEmailSummary(attachSummaryProducts(JSON.stringify(brief), { status: "available", products: b2bProducts }, inquiry));
  assert.deepEqual(result.productSkus, ["ABS"]);
  assert.deepEqual(result.unresolvedProducts, []);
  const excluded = parseEmailSummary(attachSummaryProducts(JSON.stringify({ ...brief, productSkus: ["PLA-CF", "PETG-BASIC"] }), { status: "available", products: b2bProducts }, { text: "Please quote silk PLA, not PLA-CF. No PETG." }));
  assert.deepEqual(excluded.productSkus, ["PLA-SILK-BASIC"]);
});

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
  assert.deepEqual(result.products, products.slice(0, 2).map(product => ({ sku: product.sku, title: product.name, imageUrl: product.imageUrl, price: product.price })));
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
  assert.throws(() => parseEmailSummary(JSON.stringify({ ...brief, productSkus: Array(101).fill("PETG-CF") })));
});

test("analysis guidance identifies Shopify buyers and preserves product grade distinctions", () => {
  assert.match(emailSummaryInstruction, /Shopify contact-form buyer inquiry/);
  assert.match(emailSummaryInstruction, /Keep PETG distinct from PETG-CF/);
  assert.match(emailSummaryInstruction, /ask to confirm the grade or finish instead of guessing/);
});
