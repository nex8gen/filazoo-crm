import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import { variantTag, variantsFromTags } from "../lib/product-utils.ts";
import { addVariantOption, newProductVariant, variantOptionsError, variantPriceSummary, variantSettingsError } from "../lib/product-variants.ts";
import { normalizeProductVariants } from "../lib/product-pricing.ts";

test("round-trips individually editable product variants through product tags", () => {
  const variants = [
    { id: "v1", name: "Ocean Blue", sku: "PLA-01-BLUE", price: "$6.10", stockStatus: "In stock", imageUrl: "https://example.com/blue.jpg" },
    { id: "v2", name: "Cherry Red", sku: "PLA-01-RED", price: "$6.25", stockStatus: "Preorder", imageUrl: null },
  ];
  assert.deepEqual(variantsFromTags([variantTag(variants)], [], "PLA-01", "$5.00", "Quote available"), variants);
});

test("builds a downloadable PDF from only the selected products", () => {
  const selected = [b2bProducts[0], b2bProducts[3]];
  const pdf = buildCatalogPdf(selected, { title: "Distributor selection", customer: "Acme Printing", date: "2026-10-15" });
  const text = new TextDecoder().decode(pdf);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /Distributor selection/);
  assert.match(text, /Basic PLA/);
  assert.match(text, /PLA Pro/);
  assert.doesNotMatch(text, /Macaron PLA/);
  assert.match(text, /\(Type\) Tj/);
  assert.match(text, /EXW unit price/);
  assert.doesNotMatch(text, /Default photo|Tier [123]/);
  assert.match(text, /\/MediaBox \[0 0 842 595\]/);
  assert.ok((text.match(/\/Type \/Page\b/g)?.length ?? 0) >= 1);
});

test("adding a variant after a removal skips SKUs that are still in use", () => {
  const variants = b2bProducts[0].variants.slice(0, 2).map((variant, index) => ({ ...variant, sku: index === 0 ? "PLA-01" : "PLA-03" }));
  const variant = newProductVariant("PLA", variants, "$5.00");
  assert.equal(variant.sku, "PLA-04");
  assert.equal(variant.price, "$5.00");
  assert.equal(variants.length, 2);
});

test("new option combinations preserve existing identities and never copy stock or barcodes to a new SKU", () => {
  const before = b2bProducts[0].variants.slice(0, 2).map((variant, index) => ({ ...variant, manualInventory: 100 + index, barcode: `barcode-${index}` }));
  const after = addVariantOption(before, "Weight", ["1 kg", "3 kg"], b2bProducts[0].sku);
  assert.equal(after.length, 4);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].sku, before[0].sku);
  assert.equal(after[0].manualInventory, 100);
  assert.equal(after[1].manualInventory, null);
  assert.equal(after[1].barcode, null);
  assert.notEqual(after[1].id, before[0].id);
  assert.equal(new Set(after.map(variant => variant.sku)).size, 4);
  assert.deepEqual(after[2].options, [{ name: "Color", value: before[1].name }, { name: "Weight", value: "1 kg" }]);
  assert.equal(variantOptionsError(after), null);
  assert.match(variantOptionsError([...after, { ...after[0], id: "duplicate" }])!, /different option combination/);
  assert.throws(() => addVariantOption(before, "Color", ["New"], "PLA"), /different product options/);
  assert.throws(() => addVariantOption(before, "Weight", Array.from({ length: 51 }, (_, i) => String(i)), "PLA"), /100 variants/);
});

test("advanced prices and option selections round-trip while internal costs stay out of customer PDFs", () => {
  const variant = { ...b2bProducts[0].variants[0], price: "18.90", compareAtPrice: "22.99", costPerItem: "7.34", barcode: "000123456", unitPricing: { quantity: 3, referenceQuantity: 1, unit: "kg" as const }, options: [{ name: "Color", value: "White" }] };
  const normalized = normalizeProductVariants([variant], "USD", 18.90);
  assert.equal(variantSettingsError(variant), null);
  assert.ok(Math.abs(variantPriceSummary(variant).unitPrice! - 6.3) < 1e-9);
  assert.equal(variantPriceSummary({ ...variant, price: "0" }).margin, null);
  const saved = variantsFromTags([variantTag(normalized)], [], "PLA", "$18.90", "Unknown");
  assert.equal(saved[0].barcode, "000123456");
  assert.equal(saved[0].costPerItem, "$7.34");
  assert.equal(saved[0].compareAtPrice, "$22.99");
  assert.deepEqual(saved[0].unitPricing, variant.unitPricing);
  assert.deepEqual(saved[0].options, variant.options);
  const pdf = new TextDecoder().decode(buildCatalogPdf([{ ...b2bProducts[0], variants: saved }], { title: "Prices", date: "2026-11-18" }));
  // Inspect rendered text; vector logo coordinates can contain the same digits.
  const text = [...pdf.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)].map(match => match[0]).join("\n");
  assert.doesNotMatch(text, /7\.34|Cost per item|Profit per item/);
});
