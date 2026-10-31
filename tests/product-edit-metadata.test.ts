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
import * as pricing from "../lib/product-pricing.ts";
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
  let race = false, fail = false;
  const exports = {};
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} }, "@/lib/auth": { requireWorkspaceMember: async () => ({ id: ownerId, role }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from(table: string) {
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
    "@/lib/types": types, "@/lib/product-utils": products, "@/lib/product-pricing": pricing, "@/lib/product-images": images,
    "@/lib/data/product-personalization": service,
    "@/lib/data/flow-runtime": {}, "@/lib/lead-assignment": {}, "@/lib/company-commerce": commerce, "@/lib/data/catalog-pdfs": {},
    "@/lib/company-profile-fields": fields, "@/lib/product-edit-metadata": metadata,
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/crm-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name] ?? require(name)), Date, FormData, URL, Error, console });
  const form = new FormData();
  Object.entries({ originalSku: "PLA", sku: "PLA", name: "Renamed PLA", material: "PLA", diameter: "1.75mm", weight: "1kg", currency: "USD", minimum1: "1", price1: "2.50", stockStatus: "In stock", leadTime: "7 days", imageUrl: baseline.image_url, active: "true", variants: JSON.stringify(products.variantsFromTags(baseline.tags, [], "PLA", "$5.00", "In stock")) }).forEach(([key, value]) => form.set(key, value));
  return { update: (exports as typeof import("../app/crm-actions.ts")).updateProduct, form, baseline, tables, service,
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
