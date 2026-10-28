import assert from "node:assert/strict";
import test from "node:test";
import { quantityPriceRanges, quantityPricingError } from "../lib/quantity-pricing.ts";
import { crmProduct } from "../lib/product-utils.ts";

test("edited product quantity boundaries survive storage and have no overlapping endpoints", () => {
  const product = crmProduct({ sku: "EDITED", name: "Custom product", image_url: null, material: "PLA", color: null,
    diameter: null, weight: null, price: 7, currency: "USD", moq: 1, stock_status: null, lead_time: null, active: true,
    sheet_updated_at: null, tags: ["price-tier:201:5", "price-tier:1:7", "price-tier:101:6"] });
  assert.deepEqual(quantityPriceRanges(product.priceTiers).map(tier => [tier.label, tier.price]), [
    ["1 to 100 qty", "$7.00"], ["101 to 200 qty", "$6.00"], ["201+ qty", "$5.00"],
  ]);
  const otherProduct = quantityPriceRanges([{ minimumQuantity: 20, price: "$9.00" }, { minimumQuantity: 200, price: "$8.00" }]);
  assert.equal(otherProduct[0].label, "20 to 199 qty");
  assert.equal(quantityPriceRanges(product.priceTiers)[0].label, "1 to 100 qty");
});

test("rejects invalid ranges and missing prices, and accepts zero prices", () => {
  for (const minimumQuantity of [0, -1, 1.5, NaN, Infinity]) assert.ok(quantityPricingError([{ minimumQuantity, price: "7" }]));
  for (const minimumQuantity of [1, 0]) assert.ok(quantityPricingError([{ minimumQuantity: 1, price: "7" }, { minimumQuantity, price: "6" }]));
  for (const price of ["", " ", "NaN", "-1"]) assert.ok(quantityPricingError([{ minimumQuantity: 1, price }]));
  assert.equal(quantityPricingError([{ minimumQuantity: 1, price: "0" }, { minimumQuantity: 101, price: "6.00" }]), null);
});
