import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";
import ts from "typescript";
import * as catalogPdf from "../lib/catalog-pdf.ts";
import * as imageLayout from "../lib/catalog-image-layout.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import type { Product } from "../lib/types.ts";
import * as productImages from "../lib/product-images.ts";

const require = createRequire(import.meta.url);
async function fixture() {
  const red = await sharp({ create: { width: 124, height: 124, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const bordered = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#000000" } })
    .composite([{ input: red, left: 2, top: 2 }]).png().toBuffer();
  const blue = await sharp({ create: { width: 80, height: 160, channels: 4, background: "#0000ff" } }).png().toBuffer();
  const assets = new Map([
    [catalogPdf.DEFAULT_CATALOG_IMAGE, red], ["/quotation-2610/PLA/red.png", bordered],
    ["https://assets.example/blue.png", blue],
  ]);
  const fetched: string[] = [], files: string[] = [];
  const exports = {} as {
    loadCatalogImages: (products: Product[]) => Promise<Map<string, catalogPdf.CatalogImage>>;
    buildServerCatalogPdf: (products: Product[]) => Promise<Uint8Array>;
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:fs/promises": { readFile: async (file: string) => {
      const url = "/" + path.relative(path.join(process.cwd(), "public"), file).split(path.sep).join("/");
      files.push(url); if (!assets.has(url)) throw new Error("Missing photo"); return assets.get(url);
    } }, "node:path": path, sharp,
    "./catalog-pdf.ts": catalogPdf, "./catalog-image-layout.ts": imageLayout,
    "./product-images.ts": productImages,
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/catalog-pdf-server.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Buffer, URL, AbortSignal,
    process: { cwd: process.cwd, env: { NEXT_PUBLIC_SUPABASE_URL: "https://assets.example" } },
    fetch: async (url: URL) => { fetched.push(url.href); const bytes = assets.get(url.href); return bytes ? new Response(bytes) : new Response(null, { status: 404 }); },
  });
  const product: Product = { ...b2bProducts[0], imageUrl: "/quotation-2610/PLA/red.png", variants: [
    { ...b2bProducts[0].variants[0], name: "Blue", imageUrl: "https://assets.example/blue.png" },
    { ...b2bProducts[0].variants[1], name: "Red", imageUrl: null },
    { ...b2bProducts[0].variants[2], name: "Missing variant photo", imageUrl: "https://assets.example/missing.png" },
  ] };
  return { ...exports, product, files, fetched };
}

test("server catalogs load exact variant/product photos, remove imported edges, and retain aspect ratios", async () => {
  const app = await fixture();
  const images = await app.loadCatalogImages([app.product]);
  const red = images.get(app.product.imageUrl!)!, blue = images.get(app.product.variants[0].imageUrl!)!;
  assert.deepEqual([red.width, red.height], [124, 124]);
  assert.deepEqual([blue.width, blue.height], [80, 160]);
  const pixels = await sharp(Buffer.from(red.bytes)).raw().toBuffer();
  assert.ok(pixels[0] > 240 && pixels[1] < 20 && pixels[2] < 20, "source-table border must be absent from the first pixel");
  const bluePixels = await sharp(Buffer.from(blue.bytes)).raw().toBuffer();
  assert.ok(bluePixels[2] > 240 && bluePixels[0] < 20);
  assert.ok(!images.has("https://assets.example/missing.png"));
  assert.ok(images.has(catalogPdf.DEFAULT_CATALOG_IMAGE));
  assert.equal(app.fetched.filter(url => url === "https://assets.example/blue.png").length, 1);
});

test("automated server exports include images and the approved template, including product-photo fallback", async () => {
  const app = await fixture();
  const bytes = await app.buildServerCatalogPdf([app.product]);
  const pdf = Buffer.from(bytes).toString("latin1");
  assert.match(pdf, /^%PDF-1.4/);
  assert.match(pdf, /Product catalog/);
  assert.match(pdf, /cm 0 0 0 rg/);
  assert.match(pdf, /0.976 0.858 0.878 rg/);
  assert.equal(pdf.match(/\/Subtype \/Image/g)?.length, 3);
  const draws = [...pdf.matchAll(/cm \/(I\d+) Do Q/g)].map(match => match[1]);
  assert.equal(draws.length, 3);
  assert.notEqual(draws[0], draws[1], "blue variant must use its own image");
  assert.equal(draws[1], draws[2], "missing variant photo must fall back to its product, not another variant");
  assert.match(pdf, /\(Blue\) Tj/);
  assert.match(pdf, /\(Red\) Tj/);
});

test("image loading rejects untrusted URLs and paths outside public", async () => {
  const app = await fixture();
  const product = { ...app.product, imageUrl: "/../private.png", variants: [
    { ...app.product.variants[0], imageUrl: "https://untrusted.example/private.png" },
  ] };
  const images = await app.loadCatalogImages([product]);
  assert.deepEqual(app.fetched, []);
  assert.deepEqual(app.files, [catalogPdf.DEFAULT_CATALOG_IMAGE]);
  assert.equal(images.size, 1);
});
