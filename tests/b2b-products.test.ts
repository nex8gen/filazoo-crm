import assert from "node:assert/strict";
import test from "node:test";
import { b2bProducts } from "../lib/data/b2b-products.ts";

test("keeps the complete B2B quotation catalog", () => {
  assert.equal(b2bProducts.length, 57);
  assert.equal(new Set(b2bProducts.map((product) => product.sku)).size, 57);
  assert.ok(b2bProducts.every((product) => product.priceTiers.length === 3));
  assert.ok(b2bProducts.every((product) => product.colors.length > 0));
});
