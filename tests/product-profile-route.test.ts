import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);

function load(file: string, dependencies: Record<string, unknown>) {
  const exports = {} as { default: (props: { params: Promise<{ sku: string }> }) => Promise<React.ReactNode> };
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name) });
  return exports;
}

function fixture(products = [{ sku: "ABS", name: "ABS filament" }]) {
  let authorized = false;
  const details = load("app/products/[sku]/product-detail.tsx", {
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
    "@/lib/auth": { async requireWorkspaceMember() { authorized = true; } },
    "@/lib/data/crm": { async listProducts(skus: string[]) {
      assert.ok(authorized);
      assert.deepEqual(Array.from(skus), ["ABS"]);
      return { mode: "supabase", products };
    } },
    "@/components/products-catalog-v2": { ProductDetail: ({ product }: { product: { name: string } }) => React.createElement("form", null, product.name) },
  });
  const page = load("app/products/[sku]/page.tsx", {
    "./product-detail": details,
    "@/app/products/page": { default: () => React.createElement("div", { "data-catalog": true }, "Product list") },
    "@/components/product-profile-sheet": { ProductProfileSheet: ({ children, returnToCatalog }: { children: React.ReactNode; returnToCatalog: boolean }) => {
      assert.equal(returnToCatalog, true);
      return React.createElement("section", { role: "dialog" }, children);
    } },
  });
  return { page, details };
}

test("refreshing or directly opening a product renders its dialog over the catalog", async () => {
  const { page } = fixture();
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ sku: "ABS" }) }));
  assert.match(html, /data-catalog="true"/);
  assert.match(html, /role="dialog"><form>ABS filament<\/form>/);
  assert.equal((html.match(/role="dialog"/g) ?? []).length, 1);
});

test("in-app interception loads only the details inside the existing sheet layout", async () => {
  const { details } = fixture();
  const page = load("app/@product/(.)products/[sku]/page.tsx", {
    "@/app/products/[sku]/product-detail": details,
  });
  assert.equal(page.default, details.default);
  const html = renderToStaticMarkup(await page.default({ params: Promise.resolve({ sku: "ABS" }) }));
  assert.equal(html, "<form>ABS filament</form>");
});

test("missing products still return not found on direct and intercepted routes", async () => {
  const { page, details } = fixture([]);
  for (const route of [page, details]) {
    await assert.rejects(route.default({ params: Promise.resolve({ sku: "ABS" }) }), /NOT_FOUND/);
  }
});
