import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as personalization from "../lib/product-personalization.ts";
import { normalizeProductVariants, validVariantPrice } from "../lib/product-pricing.ts";
import * as images from "../lib/product-images.ts";
import { crmProduct, variantTag } from "../lib/product-utils.ts";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";

const require = createRequire(import.meta.url);
const owner = "a1111111-1111-4111-8111-111111111111", other = "b2222222-2222-4222-8222-222222222222";
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name), Error, Buffer, Request, Response, URL, TextEncoder, Uint8Array, console });
  return exports as T;
}
const variant = { id: "black", name: "Black", sku: "ABS-BLACK", price: "$7.09", stockStatus: "Quote available", imageUrl: null };
const baseline = { sku: "ABS", name: "ABS", price: 7.09, currency: "USD", moq: 1, material: "ABS", image_url: null, color: "Black", diameter: null, weight: null, stock_status: "Quote available", lead_time: null, active: true, sheet_updated_at: null, tags: ["price-tier:1:7.09", variantTag([variant])] };

test("stored JSON cannot overwrite product identifiers or ownership metadata", () => {
  const [personal] = personalization.personalizeProductRows([baseline], [{ product_sku: "ABS", updated_at: "version-1", data: { sku: "FORGED", user_id: other, name: "My ABS", price: 8 } }]);
  assert.equal(personal.sku, "ABS"); assert.equal(personal.name, "My ABS"); assert.equal(personal.price, 8);
  assert.equal(Object.hasOwn(personal, "user_id"), false); assert.equal(baseline.price, 7.09);
});

test("variants inheriting the base price follow edits while independent variant prices remain", () => {
  const variants = normalizeProductVariants([variant, { ...variant, id: "custom", sku: "ABS-CUSTOM", price: "$8.75" }], "EUR", 8, { price: 7.09, variants: [variant, { ...variant, id: "custom", price: "$8.75" }] });
  assert.equal(variants[0].price, "€8.00"); assert.equal(variants[1].price, "€8.75");
  assert.equal(normalizeProductVariants([{ ...variant, price: "0" }], "USD", 8)[0].price, "$0.00");
  assert.equal(validVariantPrice("CN¥1,234.00"), true); assert.equal(validVariantPrice("bad"), false);
});

test("currency, prices, variant photos, and removed images survive product conversion and PDF export", () => {
  const [row] = personalization.personalizeProductRows([baseline], [{ product_sku: "ABS", updated_at: "saved", data: { currency: "EUR", price: 8, tags: ["price-tier:1:8", variantTag([{ ...variant, price: "€8.50", imageUrl: null }])], image_url: null } }]);
  const product = crmProduct(row);
  assert.equal(product.price, "€8.00"); assert.equal(product.overrideVersion, "saved"); assert.equal(product.imageUrl, null);
  assert.equal(product.variants[0].price, "€8.50");
  assert.match(Buffer.from(buildCatalogPdf([product])).toString(), /^%PDF-/);
});

test("product image validation accepts imported photos and private routes and rejects traversal", () => {
  for (const value of ["", "/quotation-2610/ABS/black.png", `/api/product-images/${owner}/${owner}.png`, "https://cdn.shopify.com/product.png"]) assert.equal(images.validProductImage(value), true, value);
  for (const value of ["/quotation-2610/../private.png", "//evil.example/x", "javascript:alert(1)", "file:///private", "/etc/passwd"]) assert.equal(images.validProductImage(value), false, value);
});

test("the actual product DAL scopes overrides to its explicit owner and fails closed on errors", async () => {
  let requestedOwner = "", failure = false;
  const overrides = [{ product_sku: "ABS", data: { price: 8 }, updated_at: "A" }];
  const q = { select() { return q; }, eq(_key: string, value: string) { requestedOwner = value; return q; }, in() { return q; }, then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: requestedOwner === owner ? overrides : [], error: failure ? { message: "offline" } : null }).then(resolve); } };
  const dal = load<typeof import("../lib/data/product-personalization.ts")>("../lib/data/product-personalization.ts", { "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from: () => q }) }, "../product-personalization.ts": personalization });
  assert.equal((await dal.withPersonalProducts([baseline], owner))[0].price, 8);
  assert.equal((await dal.withPersonalProducts([baseline], other))[0].price, 7.09);
  await assert.rejects(() => dal.withPersonalProducts([baseline], ""), /owner is required/);
  failure = true; await assert.rejects(() => dal.withPersonalProducts([baseline], owner), /Unable to load your saved/);
});

test("private image requests reject another account before storage, including administrators", async () => {
  let viewer: { id: string; role: string } | null = { id: owner, role: "viewer" }, reads = 0;
  const route = load<typeof import("../app/api/product-images/[userId]/[filename]/route.ts")>("../app/api/product-images/[userId]/[filename]/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/product-images": images,
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ storage: { from: () => ({ download: async () => { reads++; return { data: new Blob(["image"], { type: "image/png" }), error: null }; } }) } }) },
  });
  const params = { params: Promise.resolve({ userId: owner, filename: `${owner}.png` }) }, request = new Request("https://crm.example/api/product-images");
  assert.equal((await route.GET(request, params)).status, 200); assert.equal(reads, 1);
  viewer = { id: other, role: "admin" }; assert.equal((await route.GET(request, params)).status, 404); assert.equal(reads, 1);
  viewer = null; assert.equal((await route.GET(request, params)).status, 401);
});

test("catalog PDF HTTP routes scope every lookup to the current user before generation", async () => {
  let viewer: { id: string; role: string } | null = { id: owner, role: "viewer" }, filterOwner = "", renders = 0;
  const saved = { id: owner, product_skus: [], currency: "USD", price_date: "2026-10-29", version: 1, pdf_url: null, created_at: "2026-10-29", companies: { name: "Fixture" } };
  const q = { select() { return q; }, eq(key: string, value: string) { if (key === "user_id") filterOwner = value; return q; }, maybeSingle: async () => ({ data: filterOwner === owner ? saved : null, error: null }) };
  const route = load<typeof import("../app/api/catalogs/[id]/pdf/route.ts")>("../app/api/catalogs/[id]/pdf/route.ts", {
    "@/lib/auth": { getWorkspaceViewer: async () => viewer }, "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => q }) },
    "@/lib/data/catalog-pdfs": { ensureCompanyCatalogPdf: async () => { renders++; return Buffer.from("%PDF-test"); } },
    "@/lib/company-catalog-pdf": { companyCatalogPdfFilename: () => "catalog.pdf" },
  });
  const request = new Request("https://crm.example/api/catalogs/id/pdf"), params = { params: Promise.resolve({ id: owner }) };
  const result = await route.GET(request, params); assert.equal(result.status, 200); assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  viewer = { id: other, role: "admin" }; assert.equal((await route.GET(request, params)).status, 404); assert.equal(renders, 1);
  viewer = null; assert.equal((await route.GET(request, params)).status, 401);
});
