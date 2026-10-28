import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";
import { preparedAgentEmailSchema } from "../lib/ai/agent-actions.ts";
import { agentEmailSchema } from "../lib/ai/workspace-assistant.ts";
import type { Product } from "../lib/types.ts";

const require = createRequire(import.meta.url);
const email = { to: "buyer@example.com", subject: "Catalog", text: "The catalog is attached.", delivery: "draft" as const, attachCatalog: true };
function fixture() {
  let products = [{ ...b2bProducts[0], status: "Active" }];
  let renders = 0;
  let failure = false;
  let oversized = false;
  const exports = {};
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "../data/crm": { listProducts: async () => ({ mode: "live", products }) },
    "../catalog-pdf-server": { buildServerCatalogPdf: async (selected: Product[]) => {
      renders++;
      if (failure) throw new Error("PDF generation failed.");
      if (oversized) return Buffer.alloc(7_500_001);
      return buildCatalogPdf(selected);
    } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/ai/agent-catalog.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Buffer, require: (name: string) => dependencies[name] ?? require(name) });
  return { ...exports as typeof import("../lib/ai/agent-catalog.ts"), setProducts: (value: Product[]) => { products = value; }, fail: () => { failure = true; }, oversized: () => { oversized = true; }, renders: () => renders };
}

test("catalog emails use server product data and real PDF bytes; model cannot supply snapshots or bytes", async () => {
  const app = fixture();
  const prepared = await app.prepareAgentCatalog(email);
  assert.equal(preparedAgentEmailSchema.safeParse(prepared).success, true);
  assert.equal(agentEmailSchema.safeParse(prepared).success, false);
  assert.equal(agentEmailSchema.safeParse({ ...email, attachments: [{ content: "forged" }] }).success, false);
  const attachments = await app.agentCatalogAttachments(prepared);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, "Filazoo-product-catalog.pdf");
  const pdf = Buffer.from(attachments[0].content, "base64");
  assert.match(pdf.toString(), /^%PDF-/);
  assert.ok(pdf.includes(Buffer.from(b2bProducts[0].sku)) || pdf.length > 1000);
  assert.equal(pdf.length, attachments[0].size);
});

test("changed prices, missing snapshots, inactive/empty or truncated catalogs block attachment", async () => {
  const app = fixture();
  const prepared = await app.prepareAgentCatalog(email);
  app.setProducts([{ ...b2bProducts[0], status: "Active", price: "USD 999.00" }]);
  await assert.rejects(() => app.agentCatalogAttachments(prepared), /catalog changed/);
  assert.equal(app.renders(), 0);
  await assert.rejects(() => app.agentCatalogAttachments(email), /catalog changed/);
  app.setProducts([{ ...b2bProducts[0], status: "Inactive" }]);
  await assert.rejects(() => app.prepareAgentCatalog(email), /No active products/);
  app.setProducts(Array.from({ length: 500 }, () => ({ ...b2bProducts[0], status: "Active" })));
  await assert.rejects(() => app.prepareAgentCatalog(email), /complete catalog/);
});

test("PDF failures and size limits block completion, and false attachment claims are rejected", async () => {
  const app = fixture();
  const prepared = await app.prepareAgentCatalog(email);
  app.fail();
  await assert.rejects(() => app.agentCatalogAttachments(prepared), /PDF generation failed/);
  const large = fixture();
  const largePrepared = await large.prepareAgentCatalog(email);
  large.oversized();
  await assert.rejects(() => large.agentCatalogAttachments(largePrepared), /could not be attached/);
  await assert.rejects(() => app.prepareAgentCatalog({ ...email, attachCatalog: false }), /no catalog PDF/);
  const plain = { ...email, text: "Thanks for your enquiry.", attachCatalog: false };
  assert.deepEqual(await app.prepareAgentCatalog(plain), plain);
  assert.equal((await app.agentCatalogAttachments(plain)).length, 0);
});
