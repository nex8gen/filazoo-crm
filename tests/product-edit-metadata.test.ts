import { policyTestDependency } from "./helpers/ai-policy.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as metadata from "../lib/product-edit-metadata.ts";
import * as products from "../lib/product-utils.ts";
import * as types from "../lib/types.ts";
import * as commerce from "../lib/company-commerce.ts";
import * as fields from "../lib/company-profile-fields.ts";
import * as images from "../lib/product-images.ts";
import * as media from "../lib/product-media.ts";
import * as content from "../lib/product-content.ts";
import * as pricing from "../lib/product-pricing.ts";
import * as variantOptions from "../lib/product-variants.ts";
import { personalProductService } from "./helpers/personal-products.ts";

const require = createRequire(import.meta.url);
const ownerId = "a1111111-1111-4111-8111-111111111111";
const otherId = "b2222222-2222-4222-8222-222222222222";
function fixture(role = "admin") {
  const baseline = { sku: "PLA", name: "Original PLA", price: 5, currency: "USD", color: "White", active: true,
    image_url: "/quotation-2610/PLA/white.png", tags: ["b2b", "quotation-2610", "price-tier:1:5", products.variantTag([{ id: "white", name: "White", sku: "PLA-WHITE", price: "$5.00", stockStatus: "In stock", imageUrl: "/quotation-2610/PLA/white.png" }])],
    description: "Keep these technical specifications.", sheet_updated_at: "2026-10-29T00:00:00Z" };
  const tables: Record<string, Record<string, unknown>[]> = { products: [baseline], user_product_overrides: [] };
  const service = personalProductService(tables);
  let race = false, fail = false, creating = false;
  const exports = {};
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} }, "@/lib/auth": { requireWorkspaceMember: async () => ({ id: ownerId, role }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from(table: string) {
      if (creating && table === "products") return { async insert(value: Record<string, unknown>) { tables.products.push(value); return { error: null }; } };
      assert.equal(table, "user_product_overrides", "Edits must never update the shared baseline");
      let values: Record<string, unknown> | undefined, inserting = false;
      const guards: Array<[string, unknown]> = [];
      const q = { select() { return q; }, eq(key: string, value: unknown) { guards.push([key, value]); return q; },
        update(value: Record<string, unknown>) { values = value; return q; }, insert(value: Record<string, unknown>) { values = value; inserting = true; return q; },
        async maybeSingle() {
          if (fail) return { data: null, error: { code: "DB_ERROR" } };
          if (race) return { data: null, error: inserting ? { code: "23505" } : null };
          if (inserting) { tables[table].push(values!); return { data: values, error: null }; }
          const row = tables[table].find((row) => guards.every(([key, value]) => row[key] === value));
          if (!row) return { data: null, error: null };
          Object.assign(row, values); return { data: row, error: null };
        } };
      return q;
    } }) },
    "@/lib/types": types, "@/lib/product-utils": products, "@/lib/product-pricing": pricing, "@/lib/product-images": images, "@/lib/product-variants": variantOptions,
    "@/lib/product-content": content,
    "@/lib/product-media": media,
    "@/lib/data/product-media": { validateProductMediaReferences: async (_viewer: unknown, urls: string[]) => urls.some(url => url?.includes("/api/product-media/")) && urls.some(url => url?.includes(otherId)) ? "Some selected media is unavailable in this company library." : null },
    "@/lib/data/product-personalization": service,
    "@/lib/data/flow-runtime": {}, "@/lib/lead-assignment": {}, "@/lib/company-commerce": commerce, "@/lib/data/catalog-pdfs": {},
    "@/lib/company-profile-fields": fields, "@/lib/product-edit-metadata": metadata,
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/crm-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name] ?? require(name)), Date, FormData, URL, Error, console });
  const form = new FormData();
  Object.entries({ originalSku: "PLA", sku: "PLA", name: "Renamed PLA", material: "PLA", diameter: "1.75mm", weight: "1kg", currency: "USD", minimum1: "1", price1: "2.50", stockStatus: "In stock", leadTime: "7 days", imageUrl: baseline.image_url, active: "true", variants: JSON.stringify(products.variantsFromTags(baseline.tags, [], "PLA", "$5.00", "In stock")) }).forEach(([key, value]) => form.set(key, value));
  return { update: (exports as typeof import("../app/crm-actions.ts")).updateProduct, form, baseline, tables, service,
    async create() {
      creating = true;
      try { return await (exports as typeof import("../app/crm-actions.ts")).createProduct(undefined, form); }
      finally { creating = false; }
    },
    remove() { tables.products = []; }, race() { race = true; }, fail() { fail = true; } };
}

test("all workspace roles save private prices, local photos and variants without the missing colors field", async () => {
  for (const role of ["admin", "operator", "bd_manager", "viewer"]) {
    const f = fixture(role);
    assert.ok((await f.update(undefined, f.form))?.success, role);
    const [own] = await f.service.userProductRows(ownerId);
    const [other] = await f.service.userProductRows(otherId);
    assert.equal((own as unknown as { name: string }).name, "Renamed PLA");
    assert.equal((other as unknown as { name: string }).name, "Original PLA");
    assert.equal(f.baseline.price, 5);
    const data = f.tables.user_product_overrides[0].data as typeof f.baseline;
    assert.equal(data.description, f.baseline.description);
    assert.ok(data.tags.includes("b2b") && data.tags.includes("quotation-2610") && data.tags.includes("price-tier:1:2.5"));
    assert.equal(data.image_url, f.baseline.image_url);
    assert.equal(products.variantsFromTags(data.tags, [], "PLA", "", "")[0].price, "$2.50");
  }
});

test("product deletion, database errors, and concurrent first saves cannot report a successful edit", async () => {
  for (const scenario of ["remove", "race", "fail"] as const) {
    const f = fixture(); f[scenario]();
    const result = await f.update(undefined, f.form);
    assert.ok(result?.error, scenario); assert.equal(result?.success, undefined);
    assert.equal(f.tables.user_product_overrides.length, 0);
  }
});

test("stale forms cannot overwrite a newer private version, and current forms can save again", async () => {
  const f = fixture(); await f.update(undefined, f.form);
  f.form.set("name", "Stale overwrite");
  assert.match((await f.update(undefined, f.form))?.error ?? "", /another tab/);
  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  assert.ok((await f.update(undefined, f.form))?.success);
  assert.equal(f.tables.user_product_overrides.length, 1);
});

test("private product images are restricted to their owner and image removal persists", async () => {
  const f = fixture();
  f.form.set("imageUrl", `/api/product-images/${otherId}/${ownerId}.png`);
  assert.match((await f.update(undefined, f.form))?.error ?? "", /own account/);
  f.form.set("imageUrl", `/api/product-images/${ownerId}/${ownerId}.png`);
  assert.ok((await f.update(undefined, f.form))?.success);
  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  f.form.set("imageUrl", "");
  assert.ok((await f.update(undefined, f.form))?.success);
  assert.equal((f.tables.user_product_overrides[0].data as { image_url: unknown }).image_url, null);
});

test("company images and videos persist in galleries while the saved cover remains an image", async () => {
  const f = fixture();
  const image = `/api/product-media/${ownerId}/media.png`, video = `/api/product-media/${ownerId}/media.mp4`;
  f.form.set("mediaUrls", JSON.stringify([video, image]));
  f.form.set("imageUrl", image);
  assert.ok((await f.update(undefined, f.form))?.success);
  const [loaded] = await f.service.userProductRows(ownerId);
  const product = products.crmProduct(loaded);
  assert.deepEqual(product.mediaUrls, [video, image]);
  assert.equal(product.imageUrl, image);
  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  f.form.set("mediaUrls", JSON.stringify([`/api/product-media/${otherId}/media.png`]));
  assert.match((await f.update(undefined, f.form))?.error ?? "", /unavailable in this company library/);
  const fresh = fixture(); fresh.form.set("mediaUrls", JSON.stringify([video])); fresh.form.set("imageUrl", "");
  assert.ok((await fresh.create())?.success);
  assert.equal(fresh.tables.products[1].image_url, null);
  assert.deepEqual(images.productMediaFromTags(fresh.tables.products[1].tags as string[], []), [video]);
});

test("duplicate variants and invalid variant prices cannot enter saved PDFs", async () => {
  for (const price of ["abc", "-1", "Infinity", "1.234", ""]) {
    const f = fixture(); const variants = JSON.parse(String(f.form.get("variants"))); variants[0].price = price;
    f.form.set("variants", JSON.stringify(variants)); assert.ok((await f.update(undefined, f.form))?.error, price);
  }
  const f = fixture(); const variants = JSON.parse(String(f.form.get("variants")));
  f.form.set("variants", JSON.stringify([...variants, { ...variants[0], id: "second" }]));
  assert.match((await f.update(undefined, f.form))?.error ?? "", /unique SKU/);
});

test("generated price descriptions refresh while an intentionally empty custom description is preserved", () => {
  assert.equal(metadata.productEditMetadata({ description: "Volume pricing: old", tags: ["manual"] }, [], "Volume pricing: new").description, "Volume pricing: new");
  assert.equal(metadata.productEditMetadata({ description: "" }, [], "Generated").description, "");
});

test("manual inventory saves privately, survives reloads and unrelated edits, and can be cleared", async () => {
  const f = fixture();
  f.form.set("manualInventory", "1250");
  assert.ok((await f.update(undefined, f.form))?.success);
  let [row] = await f.service.userProductRows(ownerId);
  assert.equal(products.crmProduct(row).manualInventory, 1250);
  assert.equal(products.crmProduct(row).stockStatus, "1,250 available");
  const [other] = await f.service.userProductRows(otherId);
  assert.equal(products.crmProduct(other).manualInventory, null);

  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  f.form.delete("manualInventory");
  f.form.set("name", "New product name");
  assert.ok((await f.update(undefined, f.form))?.success);
  [row] = await f.service.userProductRows(ownerId);
  assert.equal(products.crmProduct(row).manualInventory, 1250);

  for (const quantity of ["0", "30", ""]) {
    f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
    f.form.set("manualInventory", quantity);
    // A previously displayed quantity must not survive clearing the manual field.
    f.form.set("stockStatus", "1,250 available");
    assert.ok((await f.update(undefined, f.form))?.success);
    [row] = await f.service.userProductRows(ownerId);
    const product = products.crmProduct(row);
    assert.equal(product.manualInventory, quantity === "" ? null : Number(quantity));
    assert.equal(product.stockStatus, quantity === "" ? "Stock unknown" : `${quantity} available`);
    assert.equal(row.tags?.filter((tag) => tag.startsWith("manual-inventory:")).length, quantity === "" ? 0 : 1);
  }
});

test("manual inventory rejects negative, fractional, non-numeric and unsafe quantities", async () => {
  for (const value of ["-1", "1.5", "abc", "Infinity", "9007199254740992"]) {
    const f = fixture();
    f.form.set("manualInventory", value);
    assert.match((await f.update(undefined, f.form))?.error ?? "", /manualInventory/);
    assert.equal(f.tables.user_product_overrides.length, 0);
  }
});

test("new products retain manual inventory, including zero, after loading from storage", async () => {
  for (const value of ["0", "250", ""]) {
    const f = fixture();
    f.form.set("sku", "MANUAL-PLA");
    f.form.set("manualInventory", value);
    assert.ok((await f.create())?.success);
    const [row] = await f.service.userProductRows(ownerId, ["MANUAL-PLA"]);
    assert.equal(products.crmProduct(row).manualInventory, value === "" ? null : Number(value));
    assert.equal(products.crmProduct(row).stockStatus, value === "" ? "Stock unknown" : `${value} available`);
  }
  const f = fixture();
  f.form.set("manualInventory", "-1");
  assert.ok((await f.create())?.error);
  assert.equal(f.tables.products.length, 1);
});

test("formatted descriptions and ordered product media save privately and survive unrelated edits", async () => {
  const f = fixture();
  const urls = ["https://example.com/cover.jpg", `/api/product-images/${ownerId}/${ownerId}.png`];
  f.form.set("description", '<p>Print <strong>snowflakes</strong>.</p><h2>Included</h2><ul><li>White — 1 kg</li></ul><script>bad()</script>');
  f.form.set("mediaUrls", JSON.stringify(urls));
  assert.ok((await f.update(undefined, f.form))?.success);
  let [row] = await f.service.userProductRows(ownerId);
  const product = products.crmProduct(row);
  assert.equal(product.description, "<p>Print <strong>snowflakes</strong>.</p><h2>Included</h2><ul><li>White — 1 kg</li></ul>");
  assert.deepEqual(product.mediaUrls, urls);
  assert.equal(product.imageUrl, urls[0]);
  assert.equal(f.baseline.description, "Keep these technical specifications.");
  const [other] = await f.service.userProductRows(otherId);
  assert.equal(products.crmProduct(other).imageUrl, f.baseline.image_url);

  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  f.form.delete("description"); f.form.delete("mediaUrls");
  f.form.set("imageUrl", urls[0]);
  assert.ok((await f.update(undefined, f.form))?.success);
  [row] = await f.service.userProductRows(ownerId);
  assert.deepEqual(products.crmProduct(row).mediaUrls, urls);
  assert.equal(products.crmProduct(row).description, product.description);

  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  f.form.set("description", ""); f.form.set("mediaUrls", "[]");
  assert.ok((await f.update(undefined, f.form))?.success);
  [row] = await f.service.userProductRows(ownerId);
  assert.equal(products.crmProduct(row).description, "");
  assert.deepEqual(products.crmProduct(row).mediaUrls, []);
  assert.equal(products.crmProduct(row).imageUrl, null);
});

test("product galleries reject invalid images, excessive counts and another account's photos", async () => {
  for (const urls of [["javascript:alert(1)"], ["/quotation-2610/../private.png"], Array.from({ length: 21 }, (_, index) => `https://example.com/${index}.png`), [`/api/product-images/${otherId}/${ownerId}.png`]]) {
    const f = fixture(); f.form.set("mediaUrls", JSON.stringify(urls));
    assert.ok((await f.update(undefined, f.form))?.error);
    assert.equal(f.tables.user_product_overrides.length, 0);
  }
  const f = fixture();
  f.form.set("description", `<p>Photo</p><img src="/api/product-images/${otherId}/${ownerId}.png">`);
  assert.match((await f.update(undefined, f.form))?.error ?? "", /own account/);
});

test("new product descriptions and galleries load with their selected cover image", async () => {
  const f = fixture();
  f.form.set("sku", "BUNDLE-NEW");
  f.form.set("description", "<h2>What's included</h2><p>Three filament spools.</p>");
  f.form.set("mediaUrls", JSON.stringify(["https://example.com/bundle.jpg", "https://example.com/spool.jpg"]));
  assert.ok((await f.create())?.success);
  const [row] = await f.service.userProductRows(ownerId, ["BUNDLE-NEW"]);
  const product = products.crmProduct(row);
  assert.equal(product.imageUrl, "https://example.com/bundle.jpg");
  assert.equal(product.mediaUrls?.length, 2);
  assert.match(product.description ?? "", /<h2>What&#39;s included<\/h2>/);
});

test("variant swatches and manual inventory persist on create, update and clear", async () => {
  const f = fixture();
  const variants = JSON.parse(String(f.form.get("variants")));
  Object.assign(variants[0], { colorHex: "#2376ab", manualInventory: 0 });
  f.form.set("variants", JSON.stringify(variants));
  assert.ok((await f.update(undefined, f.form))?.success);
  let [row] = await f.service.userProductRows(ownerId);
  let product = products.crmProduct(row);
  assert.equal(product.variants[0].manualInventory, 0);
  assert.equal(product.variants[0].colorHex, "#2376ab");
  assert.equal(product.variants[0].stockStatus, "0 available");
  assert.equal(product.stockStatus, "0 available");

  f.form.set("overrideVersion", String(f.tables.user_product_overrides[0].updated_at));
  Object.assign(variants[0], { manualInventory: null, stockStatus: "200 available" });
  f.form.set("variants", JSON.stringify(variants));
  assert.ok((await f.update(undefined, f.form))?.success);
  [row] = await f.service.userProductRows(ownerId);
  product = products.crmProduct(row);
  assert.equal(product.variants[0].manualInventory, null);
  assert.equal(product.variants[0].stockStatus, "Stock unknown");
  assert.equal(product.variants[0].colorHex, "#2376ab");

  const created = fixture();
  created.form.set("sku", "SWATCH-NEW");
  Object.assign(variants[0], { manualInventory: 109 });
  created.form.set("variants", JSON.stringify(variants));
  assert.ok((await created.create())?.success);
  const [newRow] = await created.service.userProductRows(ownerId, ["SWATCH-NEW"]);
  assert.equal(products.crmProduct(newRow).variants[0].manualInventory, 109);
  assert.equal(products.crmProduct(newRow).variants[0].colorHex, "#2376ab");
});

test("invalid variant quantities and swatches cannot be saved", async () => {
  for (const patch of [{ manualInventory: -1 }, { manualInventory: 1.5 }, { manualInventory: "10" }, { manualInventory: Number.MAX_SAFE_INTEGER + 1 }, { colorHex: "red" }, { colorHex: "#000;display:none" }]) {
    const f = fixture();
    const variants = JSON.parse(String(f.form.get("variants")));
    Object.assign(variants[0], patch);
    f.form.set("variants", JSON.stringify(variants));
    assert.ok((await f.update(undefined, f.form))?.error);
    assert.equal(f.tables.user_product_overrides.length, 0);
  }
});

test("advanced variant settings and custom option combinations persist through the product action", async () => {
  const f = fixture();
  const variants = variantOptions.addVariantOption(JSON.parse(String(f.form.get("variants"))), "Weight", ["1 kg", "3 kg"], "PLA");
  Object.assign(variants[0], { barcode: "0001234567890", compareAtPrice: "8.99", costPerItem: "1.25", unitPricing: { quantity: 1000, referenceQuantity: 100, unit: "g" } });
  f.form.set("variants", JSON.stringify(variants));
  assert.ok((await f.update(undefined, f.form))?.success);
  const [row] = await f.service.userProductRows(ownerId);
  const saved = products.crmProduct(row).variants;
  assert.equal(saved[0].barcode, "0001234567890");
  assert.equal(saved[0].compareAtPrice, "$8.99");
  assert.equal(saved[0].costPerItem, "$1.25");
  assert.equal(saved[0].unitPricing?.referenceQuantity, 100);
  assert.deepEqual(saved[1].options, [{ name: "Color", value: "White" }, { name: "Weight", value: "3 kg" }]);
  assert.equal(saved[1].manualInventory, null);
});

test("duplicate option combinations and invalid extended pricing cannot be saved", async () => {
  for (const patch of [{ costPerItem: "-1" }, { compareAtPrice: "bad" }, { unitPricing: { quantity: 0, referenceQuantity: 1, unit: "kg" } }, { barcode: "x".repeat(101) }]) {
    const f = fixture();
    const variants = JSON.parse(String(f.form.get("variants")));
    Object.assign(variants[0], patch);
    f.form.set("variants", JSON.stringify(variants));
    assert.ok((await f.update(undefined, f.form))?.error);
    assert.equal(f.tables.user_product_overrides.length, 0);
  }
  const f = fixture();
  const variants = variantOptions.addVariantOption(JSON.parse(String(f.form.get("variants"))), "Weight", ["1 kg", "3 kg"], "PLA");
  variants[1].options = variants[0].options;
  f.form.set("variants", JSON.stringify(variants));
  assert.match((await f.update(undefined, f.form))?.error ?? "", /different option combination/);
});
