import assert from "node:assert/strict";
import test from "node:test";
import type { ProductVariant } from "../lib/types.ts";
import { addVariantOption, removeVariantOption, reorderVariantOptions, updateVariantOption, variantOptionsError } from "../lib/product-variants.ts";
import { variantTag, variantsFromTags } from "../lib/product-utils.ts";

function fixture(): ProductVariant[] {
  return ["Black", "White"].flatMap((color, index) => ["1 kg", "250 g"].map((weight, position) => ({
    id: `${index}-${position}`, sku: `PLA-${index}-${position}`, name: `${color} / ${weight}`,
    options: [{ name: "Color", value: color }, { name: "Weight", value: weight }],
    price: String(10 + index + position), stockStatus: "In stock", manualInventory: 10 + position,
    imageUrl: `https://example.com/${color}.png`, colorHex: index === 0 ? "#000000" : "#ffffff",
    barcode: `barcode-${index}-${position}`, costPerItem: "4.25",
    stock: { available: 20 + position, onHand: 25, locked: 5 - position, warehouseIds: ["main"], syncedAt: "2026-11-19T00:00:00Z" },
    sharedInventory: { locations: [{ location: "Main", quantity: 10 + position, revision: "revision", updated_at: "2026-11-19T00:00:00Z" }] },
  })));
}

test("renaming an option or value retains every SKU's identity, inventory, barcode and pricing", () => {
  const before = fixture(), snapshot = structuredClone(before);
  const after = updateVariantOption(before, "Weight", "Pack weight", [
    { originalValue: "250 g", value: "0.25 kg" }, { originalValue: "1 kg", value: "1 kilogram" },
  ], "PLA");
  assert.deepEqual(before, snapshot);
  assert.equal(after[0].options![1].value, "0.25 kg");
  for (const variant of after) {
    const original = before.find(item => item.id === variant.id)!;
    assert.deepEqual(variant, { ...original, name: variant.name, options: variant.options });
    assert.equal(variant.options![1].name, "Pack weight");
  }
  assert.equal(variantOptionsError(after), null);
});

test("adding option values creates only new combinations with fresh SKUs and empty stock", () => {
  const before = fixture();
  const after = updateVariantOption(before, "Weight", "Weight", [
    { originalValue: "1 kg", value: "1 kg" }, { originalValue: "250 g", value: "250 g" }, { originalValue: null, value: "3 kg" },
  ], "PLA");
  assert.equal(after.length, 6);
  const added = after.filter(variant => !before.some(item => item.id === variant.id));
  assert.equal(added.length, 2);
  assert.equal(new Set(after.map(variant => variant.sku)).size, 6);
  for (const variant of added) {
    assert.equal(variant.stock, undefined);
    assert.equal(variant.manualInventory, null);
    assert.deepEqual(variant.sharedInventory, { locations: [] });
    assert.equal(variant.barcode, undefined);
    assert.equal(variant.costPerItem, undefined);
    assert.equal(variant.stockStatus, "Stock unknown");
    assert.equal(variant.options![1].value, "3 kg");
    assert.equal(variant.imageUrl, before.find(item => item.options![0].value === variant.options![0].value)!.imageUrl);
  }
  const colors = updateVariantOption(before, "Color", "Color", [{ originalValue: "Black", value: "Black" }, { originalValue: null, value: "Red" }], "PLA");
  for (const variant of colors.filter(item => item.options![0].value === "Red")) {
    assert.equal(variant.imageUrl, null);
    assert.equal(variant.colorHex, null);
  }
});

test("removing a value or dimension retains only the chosen SKUs without merging stock", () => {
  const before = fixture();
  const after = updateVariantOption(before, "Weight", "Weight", [{ originalValue: "250 g", value: "250 g" }], "PLA");
  assert.deepEqual(after, before.filter(variant => variant.options![1].value === "250 g"));
  const oneOption = removeVariantOption(before, "Weight", "250 g");
  assert.equal(oneOption.length, 2);
  for (const variant of oneOption) {
    const original = before.find(item => item.id === variant.id)!;
    assert.equal(variant.sku, original.sku);
    assert.equal(variant.manualInventory, original.manualInventory);
    assert.deepEqual(variant.stock, original.stock);
    assert.deepEqual(variant.sharedInventory, original.sharedInventory);
    assert.deepEqual(variant.options, [{ name: "Color", value: original.options![0].value }]);
  }
  assert.throws(() => removeVariantOption(oneOption, "Color", "Black"), /at least one/);
  assert.throws(() => removeVariantOption(before, "Weight", "Missing"), /Choose which/);
});

test("option and value order survives saved metadata without changing SKU data", () => {
  const before = fixture();
  const reordered = reorderVariantOptions(before, ["Weight", "Color"]);
  const after = updateVariantOption(reordered, "Weight", "Weight", [{ originalValue: "250 g", value: "250 g" }, { originalValue: "1 kg", value: "1 kg" }], "PLA");
  assert.equal(after[0].name, "250 g / Black");
  assert.deepEqual(after.map(variant => variant.id), ["0-1", "1-1", "0-0", "1-0"]);
  const saved = variantsFromTags([variantTag(after)], [], "PLA", "$10", "Unknown");
  assert.deepEqual(saved.map(variant => variant.options), after.map(variant => variant.options));
  assert.deepEqual(saved.map(variant => variant.sku), after.map(variant => variant.sku));
  assert.throws(() => reorderVariantOptions(before, ["Color", "Color"]), /same product options/);
});

test("invalid option edits do not mutate the existing variants", () => {
  const before = fixture(), snapshot = structuredClone(before);
  assert.throws(() => updateVariantOption(before, "Weight", "Color", [{ originalValue: "1 kg", value: "1 kg" }], "PLA"), /different name/);
  assert.throws(() => updateVariantOption(before, "Weight", "Weight", [{ originalValue: "1 kg", value: "same" }, { originalValue: "250 g", value: " SAME " }], "PLA"), /different/);
  assert.throws(() => updateVariantOption(before, "Weight", "Weight", [{ originalValue: "Missing", value: "1 kg" }], "PLA"), /changed while/);
  assert.throws(() => updateVariantOption(before, "Weight", "Weight", [{ originalValue: null, value: "" }], "PLA"), /at least one/);
  assert.throws(() => updateVariantOption(before, "Weight", "Weight", Array.from({ length: 51 }, (_, i) => ({ originalValue: null, value: `${i} kg` })), "PLA"), /100 variants/);
  const three = addVariantOption(before, "Finish", ["Matte"], "PLA");
  assert.throws(() => addVariantOption(three, "Size", ["Small"], "PLA"), /three different/);
  assert.deepEqual(before, snapshot);
});
