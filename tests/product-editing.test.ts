import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import { variantTag, variantsFromTags } from "../lib/product-utils.ts";

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
  assert.match(text, /Type \/ specifications/);
  assert.match(text, /EXW unit price/);
  assert.match(text, /Default photo/);
  assert.match(text, /\/MediaBox \[0 0 842 595\]/);
  assert.ok((text.match(/\/Type \/Page\b/g)?.length ?? 0) >= 1);
});
