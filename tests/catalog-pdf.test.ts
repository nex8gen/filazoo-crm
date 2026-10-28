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
  for (const variant of variants) assert.ok(pdf.includes(`(${variant.name})`), variant.name);
  assert.match(pdf, /7\+ qty/); assert.match(pdf, /25 to 99 qty/); assert.match(pdf, /100\+ qty/);
  assert.match(pdf, /12.34/); assert.match(pdf, /9.87/);
  assert.ok((pdf.match(/\/Type \/Page\b/g)?.length ?? 0) > 1);
  assert.doesNotMatch(pdf, /Tier \d|Default photos|no additional CRM/);
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
  for (const [index, tier] of priceTiers.entries()) {
    const next = priceTiers[index + 1];
    assert.ok(pdf.includes(next ? `${tier.minimumQuantity} to ${next.minimumQuantity - 1} qty:` : `${tier.minimumQuantity}+ qty:`));
    assert.ok(pdf.includes(tier.price));
  }
});

test("shows exact product-specific ranges and a vector company logo on every page", () => {
  const base = b2bProducts[0];
  const pdf = new TextDecoder().decode(buildCatalogPdf([
    { ...base, priceTiers: [{ minimumQuantity: 101, price: "$6.00" }, { minimumQuantity: 1, price: "$7.00" }, { minimumQuantity: 201, price: "$5.00" }] },
    { ...base, priceTiers: [{ minimumQuantity: 10, price: "$9.00" }, { minimumQuantity: 51, price: "$8.00" }] },
  ]));
  for (const label of ["1 to 100 qty", "101 to 200 qty", "201+ qty", "10 to 50 qty", "51+ qty"]) assert.ok(pdf.includes(label), label);
  assert.doesNotMatch(pdf, /Tier \d|Default photo|Not specified|Confirm before order|Quote available/);
  const pages = pdf.match(/\/Type \/Page\b/g)?.length;
  assert.equal(pdf.match(/cm 0 0 0 rg/g)?.length, pages);
});

test("keeps wide and tall photos inside their own variant cells and falls back to the product photo", () => {
  const base = b2bProducts[0];
  const product = { ...base, imageUrl: "/product.jpg", variants: [
    { ...base.variants[0], imageUrl: "/wide.jpg" },
    { ...base.variants[1], imageUrl: "/tall.jpg" },
    { ...base.variants[2], imageUrl: "/unavailable.jpg" },
  ] };
  const jpeg = new Uint8Array([255, 216, 255, 217]);
  const pdf = new TextDecoder().decode(buildCatalogPdf([product], { images: new Map([
    ["/wide.jpg", { bytes: jpeg, width: 1000, height: 100 }],
    ["/tall.jpg", { bytes: jpeg, width: 100, height: 1000 }],
    ["/product.jpg", { bytes: jpeg, width: 200, height: 200 }],
  ]) }));
  const draws = [...pdf.matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/I(\d) Do Q/g)];
  assert.deepEqual(draws.map(draw => draw[5]), ["0", "1", "2"]);
  draws.forEach((draw, index) => {
    const [width, height, x, y] = draw.slice(1, 5).map(Number);
    const cellLeft = 151 + index * 51;
    assert.ok(x >= cellLeft && x + width <= cellLeft + 51.01);
    assert.ok(y >= 412 && y + height <= 462.01);
    assert.ok(width <= 45.01 && height <= 50);
  });
});
