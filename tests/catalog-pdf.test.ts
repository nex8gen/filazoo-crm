import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogPdf, catalogVariantImage, DEFAULT_CATALOG_IMAGE } from "../lib/catalog-pdf.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

test("uses current variant photos before product photos, then the default", () => {
  const product = { ...b2bProducts[0], imageUrl: "/product.jpg" };
  const variant = { ...product.variants[0], imageUrl: "/variant.png" };
  assert.equal(catalogVariantImage(product, variant), "/variant.png");
  assert.equal(catalogVariantImage(product, { ...variant, imageUrl: null }), "/product.jpg");
  assert.equal(catalogVariantImage({ ...product, imageUrl: null }), DEFAULT_CATALOG_IMAGE);
});

test("paginates every variant and preserves mixed CRM price tiers without inventing prices", () => {
  const base = b2bProducts[0];
  const variants = Array.from({ length: 110 }, (_, i) => ({ ...base.variants[0], id: `v${i}`, sku: `UNIQUE-${i}`, name: `Color ${i}` }));
  const products = [
    { ...base, variants, priceTiers: [{ minimumQuantity: 7, price: "$12.34" }] },
    { ...base, sku: "OTHER", name: "Other material", material: "ABS", variants: [base.variants[0]], priceTiers: [{ minimumQuantity: 25, price: "$9.87" }, {minimumQuantity: 100, price: "$8.00"}] },
  ];
  const pdf = new TextDecoder().decode(buildCatalogPdf(products));
  for (const variant of variants) assert.ok(pdf.includes(`(${variant.sku})`), variant.sku);
  assert.match(pdf, /7\+ pcs/); assert.match(pdf, /25\+ pcs/);
  assert.match(pdf, /12.34/); assert.match(pdf, /9.87/);
  assert.ok((pdf.match(/\/Type \/Page\b/g)?.length ?? 0) > 1);
  assert.ok(pdf.includes("(-) Tj"));
});

test("binary image streams retain valid object offsets and declared lengths", () => {
  const bytes = new Uint8Array([255, 216, 0, 128, 255, 217]);
  const pdf = buildCatalogPdf([b2bProducts[0]], { images: new Map([[DEFAULT_CATALOG_IMAGE, {bytes, width: 2, height: 2}]]) });
  const text = Buffer.from(pdf).toString("latin1");
  assert.match(text, /\/Subtype \/Image/); assert.match(text, /\/Length 6 >>\nstream/);
  const start = Number(text.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(text.slice(start, start + 4), "xref");
  const entries = text.slice(start).split("\n").slice(3).filter(line => /^\d{10} 00000 n/.test(line));
  entries.forEach((entry, i) => assert.ok(text.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj`)));
});

test("keeps all quantity tiers when a mixed catalog has many columns", () => {
  const priceTiers = Array.from({length: 8}, (_, i) => ({minimumQuantity: i * 100 + 1, price: `$${20 - i}.00`}));
  const pdf = new TextDecoder().decode(buildCatalogPdf([{...b2bProducts[0], priceTiers}]));
  for (const tier of priceTiers) { assert.ok(pdf.includes(`${tier.minimumQuantity}+ pcs:`)); assert.ok(pdf.includes(tier.price)); }
});
