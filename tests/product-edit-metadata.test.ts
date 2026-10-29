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

const require = createRequire(import.meta.url);
function fixture() {
  const saved: { tags: string[]; description: string; sheet_updated_at: string | null; sku: string; name?: string } = {
    sku: "PLA", tags: ["b2b", "quotation-2610", "price-tier:1:5", "variant-json:old"], description: "Keep these technical specifications.", sheet_updated_at: "2026-10-29T00:00:00Z",
  };
  let removed = false, race = false, fail = false;
  const exports = {};
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} }, "@/lib/auth": { requireWorkspaceMember: async () => ({ role: "admin" }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from() {
      let changes: object | undefined;
      const guards: Array<[string, unknown]> = [];
      const query = { select() { return query; }, eq(key: string, value: unknown) { guards.push([key, value]); return query; }, is(key: string, value: unknown) { return query.eq(key, value); }, update(value: object) { changes = value; return query; },
        async maybeSingle() {
          if (fail) return { data: null, error: { code: "DB_ERROR" } };
          if (removed) return { data: null, error: null };
          if (!changes) return { data: { ...saved }, error: null };
          if (race) saved.sheet_updated_at = "2026-10-29T00:01:00Z";
          if (guards.some(([key, value]) => saved[key as keyof typeof saved] !== value)) return { data: null, error: null };
          Object.assign(saved, changes); return { data: { sku: saved.sku }, error: null };
        } };
      return query;
    } }) },
    "@/lib/types": types, "@/lib/product-utils": products, "@/lib/data/flow-runtime": {}, "@/lib/lead-assignment": {},
    "@/lib/company-commerce": commerce, "@/lib/data/catalog-pdfs": {}, "@/lib/company-profile-fields": fields, "@/lib/product-edit-metadata": metadata,
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/crm-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Date, FormData, URL, Error, console });
  const form = new FormData();
  Object.entries({ originalSku: "PLA", sku: "PLA", name: "Renamed PLA", material: "PLA", colors: "White", diameter: "1.75mm", weight: "1kg", currency: "USD", minimum1: "1", price1: "2.50", stockStatus: "In stock", leadTime: "7 days", imageUrl: "", active: "false", variants: JSON.stringify([{ id: "white", name: "White", sku: "PLA-WHITE", price: "2.50", stockStatus: "In stock", imageUrl: null }]) }).forEach(([key, value]) => form.set(key, value));
  return { update: (exports as typeof import("../app/crm-actions.ts")).updateProduct, form, saved, remove() { removed = true; }, race() { race = true; }, fail() { fail = true; } };
}

test("a partial product edit preserves source tags and custom specifications while replacing only managed metadata", async () => {
  const f = fixture();
  assert.ok((await f.update(undefined, f.form))?.success);
  assert.equal(f.saved.name, "Renamed PLA"); assert.equal(f.saved.description, "Keep these technical specifications.");
  assert.ok(f.saved.tags.includes("b2b")); assert.ok(f.saved.tags.includes("quotation-2610"));
  assert.ok(f.saved.tags.includes("price-tier:1:2.5")); assert.ok(!f.saved.tags.includes("price-tier:1:5"));
  assert.ok(!f.saved.tags.includes("variant-json:old"));
  assert.equal(products.variantsFromTags(f.saved.tags, [], "PLA", "2.50", "In stock")[0].sku, "PLA-WHITE");
});

test("product deletion, database errors and concurrent saves cannot report a fake successful edit", async () => {
  for (const scenario of ["remove", "race", "fail"] as const) {
    const f = fixture(); f[scenario]();
    const result = await f.update(undefined, f.form);
    assert.ok(result?.error, scenario); assert.equal(result?.success, undefined);
    assert.equal(f.saved.name, undefined);
  }
});

test("generated price descriptions refresh while an intentionally empty custom description is preserved", () => {
  assert.equal(metadata.productEditMetadata({ description: "Volume pricing: old", tags: ["manual"] }, [], "Volume pricing: new").description, "Volume pricing: new");
  assert.equal(metadata.productEditMetadata({ description: "" }, [], "Generated").description, "");
  assert.equal(metadata.productEditMetadata({ description: null }, [], "Generated").description, "Generated");
});
