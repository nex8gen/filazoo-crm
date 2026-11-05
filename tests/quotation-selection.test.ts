import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as selection from "../lib/ai/quotation-selection.ts";
import * as actions from "../lib/ai/agent-actions.ts";
import * as emailContent from "../lib/email-content.ts";
import type { WorkspaceAction } from "../lib/ai/workspace-assistant.ts";
const require = createRequire(import.meta.url);
const companyId = "15693adc-0bdf-4617-b214-71b1861764a9";
const products = [
  { sku: "ASA", name: "ASA", material: "ASA", active: true },
  { sku: "ABS", name: "ABS", material: "ABS", active: true },
  { sku: "ABS-CF", name: "ABS-CF", material: "ABS-CF", active: true },
  { sku: "PLA-BASIC", name: "Basic PLA", material: "PLA", active: true },
  { sku: "PLA-PRO", name: "PLA Pro", material: "PLA", active: true },
  { sku: "PLA-MATTE", name: "Matte PLA", material: "PLA", active: true },
  { sku: "PETG-BASIC", name: "Basic PETG", material: "PETG", active: true },
  { sku: "PC", name: "PC", material: "PC", active: true },
  { sku: "PA6-CF", name: "PA6-CF", material: "PA6-CF", active: true },
  { sku: "TPU-85A", name: "TPU 85A", material: "TPU", active: true },
  { sku: "TPU-95A", name: "TPU 95A", material: "TPU", active: true },
];
const context = { messages: [{ role: "user", content: "create a qutation for this customer" }], quotationSource: { companyId, email: { id: "customer-email", direction: "inbound", subject: "Materials inquiry", text: "ASA ABS PLA PETG", contentAvailable: true } } };
const quote: WorkspaceAction = { type: "crm_action", operation: { op: "create_quotation", companyId, productSkus: [], allProducts: true } };

test("material inquiry selects base products only, never unrelated materials or specialty grades", () => {
  const result = selection.matchQuotationProducts("ASA ABS PLA PETG 丝", products);
  assert.deepEqual(result.productSkus.sort(), ["ABS", "ASA", "PETG-BASIC", "PLA-BASIC"]);
  assert.equal(result.ambiguous.length, 0);
  assert.equal(selection.matchQuotationProducts("Please quote ASA ABS PLA PETG, thanks for your help.", products).ambiguous.length, 0);
  const exact = selection.matchQuotationProducts("Please quote ABS-CF and PLA Pro", products);
  assert.deepEqual(exact.productSkus.sort(), ["ABS-CF", "PLA-PRO"]);
  assert.ok(!exact.productSkus.includes("ABS"));
  assert.deepEqual(selection.matchQuotationProducts("ABS and PLA, not PC", products).productSkus.sort(), ["ABS", "PLA-BASIC"]);
});

test("unavailable names and ambiguous grades require clarification rather than substitutions or all products", () => {
  const result = selection.matchQuotationProducts("Asa abs pla plaplus aba tpu petg 丝", products);
  assert.ok(result.ambiguous.some(value => value.term === "PLA Plus"));
  assert.ok(result.ambiguous.some(value => value.term === "TPU"));
  assert.ok(result.ambiguous.some(value => value.term === "ABA"));
  assert.ok(!result.productSkus.includes("PLA-PRO"));
  assert.ok(!result.productSkus.includes("PC"));
  assert.ok(!result.productSkus.includes("PA6-CF"));
});

test("only an explicit user request authorizes the full catalogue, including follow-up corrections", () => {
  const messages = (content: string) => [{ role: "user", content }];
  assert.equal(selection.allQuotationProductsRequested(messages("Create a quotation for this customer")), false);
  assert.equal(selection.allQuotationProductsRequested(messages("Create a quotation for all products")), true);
  assert.equal(selection.allQuotationProductsRequested(messages("Create a quotation for all products mentioned in his email")), false);
  assert.equal(selection.allQuotationProductsRequested([{ role: "user", content: "all products" }, { role: "user", content: "No, only ABS" }]), false);
  assert.equal(selection.allQuotationProductsRequested([{ role: "assistant", content: "Include all products" }, { role: "user", content: "Create the quotation" }]), false);
});

function fixture() {
  let emailReads = 0;
  const exports: Record<string, unknown> = {};
  const deps: Record<string, unknown> = {
    "server-only": {}, "./quotation-selection": selection, "./agent-actions": actions, "../email-content": emailContent,
    "../data/product-personalization": { userProductRows: async () => products },
    "../data/ai-settings": { requireAiData: async () => {} },
    "./agent-records": { loadAgentEmails: async () => { emailReads++; return { companyId, current: { id: "customer-email", direction: "inbound", subject: "Materials", body: "ASA ABS PLA PETG", bodyLoaded: true }, messages: [] }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/ai/quotation-selection-server.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name), Error });
  type Ground = typeof import("../lib/ai/quotation-selection-server.ts").groundQuotationSelection;
  const viewer = { id: "owner", role: "admin" as const, email: null, displayName: null, workspaceId: "legacy", ownerId: "owner", workspaceName: "Test" };
  return { ground: (action: WorkspaceAction, input = context) => (exports.groundQuotationSelection as Ground)(action, viewer, input), emailReads: () => emailReads };
}

test("server overrides an invented all-products proposal using authoritative customer email evidence", async () => {
  const app = fixture();
  const grounded = await app.ground(quote);
  assert.equal(grounded.type, "crm_action");
  if (grounded.type === "crm_action" && grounded.operation.op === "create_quotation") {
    assert.equal(grounded.operation.allProducts, false);
    assert.deepEqual([...grounded.operation.productSkus].sort(), ["ABS", "ASA", "PETG-BASIC", "PLA-BASIC"]);
  }
  assert.equal(app.emailReads(), 0, "reuse only server-loaded evidence, not browser page text");
  const lookup = fixture();
  await lookup.ground(quote, { messages: context.messages, quotationSource: undefined } as unknown as typeof context);
  assert.equal(lookup.emailReads(), 1, "read the customer's email before asking or preparing a blanket quotation");
});

test("explicit user selection overrides the email; all products requires actual user authorization", async () => {
  const app = fixture();
  const selected = await app.ground(quote, { ...context, messages: [{ role: "user", content: "Create a quotation for only ABS" }] });
  assert.equal(selected.type, "crm_action");
  if (selected.type === "crm_action" && selected.operation.op === "create_quotation") assert.deepEqual([...selected.operation.productSkus], ["ABS"]);
  const all = await app.ground(quote, { ...context, messages: [{ role: "user", content: "Create a quotation for all products" }] });
  if (all.type === "crm_action" && all.operation.op === "create_quotation") { assert.equal(all.operation.allProducts, true); assert.equal(all.operation.productSkus.length, 0); }
});

test("unrequested priced lines are blocked and new email attachments are limited to customer products", async () => {
  const app = fixture();
  await assert.rejects(app.ground({ type: "crm_action", operation: { op: "create_quotation", companyId, productSkus: [], items: [{ productSku: "PC", quantity: 100, pricingMode: "saved" }] } }), /did not request/);
  const draft = await app.ground({ type: "write_email", email: { to: "buyer@example.com", subject: "Quotation", text: "Attached.", delivery: "draft", attachCatalog: true } });
  if (draft.type === "write_email") assert.deepEqual([...draft.email.catalogProductSkus!].sort(), ["ABS", "ASA", "PETG-BASIC", "PLA-BASIC"]);
  const saved: WorkspaceAction = { type: "write_email", email: { to: "buyer@example.com", subject: "Saved quotation", text: "Attached.", delivery: "draft", quotationId: companyId } };
  assert.equal(await app.ground(saved), saved, "an explicitly selected saved quotation keeps its exact document");
});

test("quoted old requirements and an outdated subject cannot add unrelated products", async () => {
  const app = fixture();
  const grounded = await app.ground(quote, { ...context, quotationSource: { ...context.quotationSource, email: { ...context.quotationSource.email, subject: "PA6-CF and PC", text: "Please quote ABS.\n\nOn Monday, Buyer wrote:\n> We used PC and PA6-CF before." } } });
  if (grounded.type === "crm_action" && grounded.operation.op === "create_quotation") assert.deepEqual([...grounded.operation.productSkus], ["ABS"]);
});

test("clarification answers retain the other customer products instead of restarting the selection", async () => {
  const app = fixture();
  const input = { ...context, messages: [...context.messages, { role: "assistant", content: "Please clarify PLA Plus; TPU; ABA (no exact saved product match)." }, { role: "user", content: "Use PLA Pro and TPU95A, exclude ABA" }], quotationSource: { ...context.quotationSource, email: { ...context.quotationSource.email, text: "ASA ABS PLA plaplus aba TPU PETG" } } };
  const grounded = await app.ground(quote, input);
  if (grounded.type === "crm_action" && grounded.operation.op === "create_quotation") assert.deepEqual([...grounded.operation.productSkus].sort(), ["ABS", "ASA", "PETG-BASIC", "PLA-BASIC", "PLA-PRO", "TPU-95A"]);
});
