import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { replyCatalogProducts, buildEmailReplyInstruction } from "../lib/ai/email-reply.ts";
import { selectCatalogProducts, catalogRequestText } from "../lib/ai/catalog-selection.ts";
import { resolveFlowCatalog } from "../lib/ai/flow-reply.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";

const customer = (body: string) => [{ direction: "inbound", body }];
const selection = (productSkus: string[]) => ({ scope: "selected" as const, productSkus });
const reply = (text: string, skus: string[]) => replyCatalogProducts({ attachCatalog: true, catalogScope: "selected", catalogProductSkus: skus }, b2bProducts, customer(text));
const skus = (products: Array<{ sku: string }>) => products.map(product => product.sku);

test("the customer's named PLA types and PETG never become a store-wide catalog", () => {
  const text = "I am interested in purchasing both PETG and PLA filaments. Regarding PLA:\n- PLA Matte\n- Standard PLA\n- PLA+\n- PLA High Speed (HS)\nColors: black, white, blue, red, yellow and pastel shades.";
  const chosen = ["PLA-MATTE-BASIC", "PLA-BASIC", "PETG-BASIC"];
  assert.deepEqual(new Set(skus(reply(text, chosen))), new Set(chosen));
  for (const unrelated of ["ABS", "ASA", "PLA-SILK-BASIC", "PLA-WOOD"])
    assert.throws(() => reply(text, [...chosen, unrelated]), /outside|types/);
  assert.throws(() => selectCatalogProducts({ scope: "all", productSkus: [] }, b2bProducts, text), /full catalog/);
});

test("a customer comparing PLA can receive the PLA range without other materials", () => {
  const text = "I'm confused about the many PLA options. Please show me all PLA products so I can compare.";
  const pla = b2bProducts.filter(product => product.material === "PLA");
  assert.deepEqual(skus(reply(text, skus(pla))), skus(pla));
  assert.deepEqual(skus(reply("I know PLA Matte. Show me other PLA options too.", skus(pla))), skus(pla));
  assert.throws(() => reply(text, [...skus(pla), "PETG-BASIC"]), /outside/);
  const pdf = Buffer.from(buildCatalogPdf(reply(text, skus(pla))));
  assert.match(pdf.toString(), /^%PDF-/);
  assert.ok(pdf.length > 1000);
});

test("a named type does not silently expand to every type in its material family", () => {
  assert.deepEqual(skus(reply("Please send only PLA Matte.", ["PLA-MATTE-BASIC"])), ["PLA-MATTE-BASIC"]);
  assert.throws(() => reply("Please send only PLA Matte.", ["PLA-MATTE-BASIC", "PLA-SILK-BASIC"]), /types/);
  assert.throws(() => reply("Standard PLA only please.", ["PLA-BASIC", "PLA-MATTE-BASIC"]), /types/);
  assert.throws(() => reply("Send PLA+ only please.", ["PLA-PRO"]), /unavailable/);
});

test("explicit general catalogs work, but missing, empty, invented and inactive selections fail closed", () => {
  assert.deepEqual(skus(selectCatalogProducts({ scope: "all", productSkus: [] }, b2bProducts, "Please send your full product catalog.")), skus(b2bProducts));
  assert.throws(() => selectCatalogProducts({ productSkus: [] }, b2bProducts), /scope/);
  assert.throws(() => selectCatalogProducts(selection([]), b2bProducts), /empty/);
  assert.throws(() => selectCatalogProducts(selection(["invented"]), b2bProducts), /unavailable/);
  assert.throws(() => selectCatalogProducts(selection(["PLA-BASIC"]), b2bProducts.map(product => ({ ...product, status: "Inactive" }))), /unavailable/);
  assert.deepEqual(selectCatalogProducts({ scope: "unavailable", productSkus: [] }, b2bProducts), []);
  assert.throws(() => selectCatalogProducts({ scope: "unavailable", productSkus: ["PLA-BASIC"] }, b2bProducts), /conflicting/);
  assert.deepEqual(replyCatalogProducts({ attachCatalog: false }, b2bProducts, customer("Do not send a catalog.")), []);
  assert.throws(() => replyCatalogProducts({ attachCatalog: true, catalogScope: "unavailable" }, b2bProducts, []), /unavailable/);
});

test("current customer corrections, exclusions and quoted history do not broaden the selection", () => {
  const history = [
    { direction: "inbound", body: "Send ABS and PETG." },
    { direction: "outbound", body: "We also offer TPU." },
    { direction: "inbound", body: "Actually, only PLA Matte.\n\nOn Tuesday, Sales wrote:\nSend ABS and PETG." },
  ];
  assert.equal(catalogRequestText(history), "Actually, only PLA Matte.");
  const plan = { attachCatalog: true, catalogScope: "selected" as const, catalogProductSkus: ["PLA-MATTE-BASIC"] };
  assert.deepEqual(skus(replyCatalogProducts(plan, b2bProducts, history)), ["PLA-MATTE-BASIC"]);
  assert.throws(() => replyCatalogProducts({ ...plan, catalogProductSkus: ["PLA-MATTE-BASIC", "ABS"] }, b2bProducts, history), /outside/);
  assert.throws(() => reply("PLA only, no PETG please.", ["PLA-BASIC", "PETG-BASIC"]), /outside/);
  assert.throws(() => selectCatalogProducts({ scope: "all", productSkus: [] }, b2bProducts, "Full catalog except PETG please."), /full catalog/);
  const withoutPetg = b2bProducts.filter(product => !product.material.startsWith("PETG"));
  assert.deepEqual(skus(reply("Full catalog except PETG please.", skus(withoutPetg))), skus(withoutPetg));
});

test("flow catalog validation also rejects a model's unrelated selection before PDF generation", () => {
  const context = { products: b2bProducts, requestText: "Only PLA Matte please." };
  const output = (scope: string, productSkus: string[]) => JSON.stringify({ intent: "requested", scope, productSkus });
  assert.throws(() => resolveFlowCatalog(output("all", []), { attachCatalog: true }, 1, skus(b2bProducts), context), /full catalog/);
  assert.throws(() => resolveFlowCatalog(output("selected", ["ABS"]), { attachCatalog: true }, 1, skus(b2bProducts), context), /outside/);
  assert.deepEqual(resolveFlowCatalog(output("selected", ["PLA-MATTE-BASIC"]), { attachCatalog: true }, 1, skus(b2bProducts), context), ["PLA-MATTE-BASIC"]);
});

test("inbox attachment preparation uses validated SKUs rather than saved or full-catalog defaults", () => {
  const source = readFileSync(new URL("../components/email-inbox.tsx", import.meta.url), "utf8");
  const generate = source.slice(source.indexOf("async function generateAiReply()"), source.indexOf("async function saveReply()"));
  assert.match(generate, /replyCatalogProducts\(plan, products, history\)/);
  assert.doesNotMatch(generate, /saved\.productSkus|catalogs\.filter/);
  assert.match(buildEmailReplyInstruction(), /does not require exact quantities/);
  assert.match(buildEmailReplyInstruction(), /do not assume PLA\+ means PLA Pro/i);
});
