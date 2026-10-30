import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as replyPolicy from "../lib/ai/flow-reply.ts";
import { blankStep } from "../lib/flows.ts";
import { crmProduct } from "../lib/product-utils.ts";
import { invoiceProduct } from "../lib/invoice-links.ts";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";
import * as signatures from "../lib/ai/email-rewrite.ts";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
function fixture() {
  const calls: Array<{ prompt: string; systemInstruction: string }> = [];
  const catalogRequests: Array<Parameters<typeof buildCatalogPdf>[0]> = [];
  const env: Record<string, string> = { GEMINI_API_KEY: "synthetic-test-key" };
  let catalogPlan = { intent: "none", scope: "all", productSkus: [] as string[] };
  let replyBodies = ["Hello from a synthetic test"];
  let geminiError: string | null = null;
  let gatewayError: string | null = null;
  const exports = {} as { generateFlowAiReply: (input: Row) => Promise<{ subject: string; body: string; inReplyTo: string | null; attachments: Array<{ content: Buffer }> }>; prepareFlowTemplateCatalog: () => Promise<Array<{ content: Buffer }>> };
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query, throwOnError: async () => ({ data: productRows }) };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from: () => query }) },
    "./product-personalization.ts": { userProductRows: async (userId: string) => { assert.equal(userId, "synthetic-owner"); return productRows; } },
    "../auth.ts": { requireWorkspaceMember: async () => ({ id: "synthetic-owner" }) },
    "../product-utils.ts": { crmProduct },
    "../invoice-links.ts": { invoiceProduct },
    "../catalog-pdf-server.ts": { buildServerCatalogPdf: async (...args: Parameters<typeof buildCatalogPdf>) => { catalogRequests.push(args[0]); return buildCatalogPdf(...args); } },
    "../ai/gemini.ts": { generateGeminiText: async (input: typeof calls[number]) => {
      if (geminiError) throw new Error(geminiError);
      calls.push(input);
      if (JSON.parse(input.prompt).task === "select_catalog_products") return JSON.stringify(catalogPlan);
      const body = replyBodies.length > 1 ? replyBodies.shift()! : replyBodies[0];
      return JSON.stringify({ subject: "Synthetic subject", body, quotes: [] });
    } },
    "../ai/gateway.ts": { isGeminiRegionError: (error: Error) => /location is not supported/.test(error.message), generateGatewayText: async () => { if (gatewayError) throw new Error(gatewayError); return JSON.stringify({ subject: "Fallback", body: "Fallback reply", quotes: [] }); } }, "../ai/flow-reply.ts": replyPolicy,
    "../ai/email-rewrite.ts": signatures,
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-ai-reply.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), process: { env }, Buffer, Error });
  return { calls, catalogRequests, exports, env, setProviderErrors: (primary: string, fallback: string) => { geminiError = primary; gatewayError = fallback; }, setCatalog: (plan: typeof catalogPlan) => { catalogPlan = plan; }, setBodies: (bodies: string[]) => { replyBodies = [...bodies]; } };
}

const productRows = ["PLA", "PETG", "ABS"].map((material) => ({ sku: material, name: `Synthetic ${material}`, material,
  image_url: null, color: "Black", diameter: "1.75mm", weight: "1kg", price: 10, currency: "USD", moq: 1,
  stock_status: "In stock", lead_time: null, tags: [], active: true, sheet_updated_at: null }));
const baseInput = () => ({ config: blankStep("ai_auto_reply").config, contact: { name: "Synthetic customer", email: "synthetic@example.com" },
  company: { name: "Synthetic company" }, managerName: "Synthetic manager", productRows,
  messages: [{ subject: "Material inquiry", body: "Synthetic message", direction: "received", created_at: "2026-10-27T00:00:00Z", message_id: "<synthetic@example.com>", thread_id: "synthetic-thread" }], previousAutomatedMessages: 1 });

test("a failed local fallback preserves the actual Google location blocker in the user-facing error", async () => {
  const app = fixture();
  app.env.VERCEL_OIDC_TOKEN = "synthetic-expired-token";
  app.setProviderErrors("User location is not supported for the API use.", "AI Gateway authentication has expired. Refresh the development token.");
  await assert.rejects(app.exports.generateFlowAiReply({ ...baseInput(), config: { ...blankStep("ai_auto_reply").config, attachCatalog: false } }), /Gemini is unavailable from this server location.*authentication has expired/);
});

test("AI product, price, catalog, first-message, language, instructions and threading options reach generation", async () => {
  const app = fixture();
  let checked = 0;
  for (const [useProducts, usePrices] of [[false, false], [true, false], [true, true]])
    for (const attachCatalog of [false, true]) for (const firstOnly of [false, true])
      for (const previous of [0, 1]) for (const language of ["auto", "en", "zh-CN"])
        for (const replyInThread of [false, true]) {
          const config = { ...blankStep("ai_auto_reply").config, useProducts, usePrices, attachCatalog, catalogFirstMessageOnly: firstOnly, language, replyInThread, instructions: "Ask about required quantity" };
          const result = await app.exports.generateFlowAiReply({ config, contact: { name: "Synthetic customer", email: "synthetic@example.com" }, company: { name: "Synthetic company" }, managerName: "Synthetic manager",
            messages: baseInput().messages, productRows: productRows.slice(0, 1), previousAutomatedMessages: previous });
          const input = app.calls.at(-1)!;
          const prompt = JSON.parse(input.prompt);
          assert.equal(prompt.products.length, useProducts ? 1 : 0);
          if (useProducts) assert.equal(Object.hasOwn(prompt.products[0], "pricing"), usePrices);
          assert.equal(prompt.managerGuidance, config.instructions);
          assert.equal(result.attachments.length, attachCatalog && firstOnly && previous === 0 ? 1 : 0);
          assert.equal(result.inReplyTo, replyInThread ? "<synthetic@example.com>" : null);
          assert.equal(result.subject, replyInThread ? "Re: Material inquiry" : "Synthetic subject");
          assert.match(input.systemInstruction, /Write in English/);
          assert.match(result.body, /Best regards,/);
          checked++;
        }
  assert.equal(checked, 144);
});

test("requested and recommended catalogs on later emails contain only selected products in the real PDF", async () => {
  for (const intent of ["requested", "recommended"]) {
    const app = fixture(); app.setCatalog({ intent, scope: "selected", productSkus: ["PLA"] });
    const input = baseInput(); input.messages[0].body = "Please send the PLA catalogue only.";
    const result = await app.exports.generateFlowAiReply(input);
    assert.equal(result.attachments.length, 1);
    assert.deepEqual(app.catalogRequests.map(products => products.map(product => product.sku)), [["PLA"]]);
    const pdf = result.attachments[0].content.toString();
    assert.match(pdf, /^%PDF/);
    assert.match(pdf, /Synthetic PLA/);
    assert.doesNotMatch(pdf, /Synthetic PETG|Synthetic ABS/);
    const draftPrompt = JSON.parse(app.calls.at(-1)!.prompt);
    assert.equal(draftPrompt.catalogAttached, true);
    assert.deepEqual(draftPrompt.attachedCatalogProducts.map((p: { sku: string }) => p.sku), ["PLA"]);
    assert.match(app.calls[0].systemInstruction, /including misspellings/);
    assert.match(app.calls[0].systemInstruction, /PLA requests must include only PLA/);
  }
});

test("send-catalog flow templates use the shared server export for every active product", async () => {
  const app = fixture();
  const attachments = await app.exports.prepareFlowTemplateCatalog();
  assert.equal(attachments.length, 1);
  assert.deepEqual(app.catalogRequests.map(products => Array.from(products, product => product.sku)), [["PLA", "PETG", "ABS"]]);
  assert.match(attachments[0].content.toString(), /cm 0 0 0 rg/);
});

test("first emails also honor product scope and customer refusal; unknown selections cannot attach everything", async () => {
  const app = fixture(); const input = { ...baseInput(), previousAutomatedMessages: 0 };
  app.setCatalog({ intent: "none", scope: "selected", productSkus: ["PLA"] });
  assert.doesNotMatch((await app.exports.generateFlowAiReply(input)).attachments[0].content.toString(), /Synthetic PETG|Synthetic ABS/);
  app.setCatalog({ intent: "declined", scope: "all", productSkus: [] });
  assert.equal((await app.exports.generateFlowAiReply(input)).attachments.length, 0);
  app.setCatalog({ intent: "requested", scope: "unavailable", productSkus: [] });
  assert.equal((await app.exports.generateFlowAiReply(input)).attachments.length, 0);
  assert.equal(JSON.parse(app.calls.at(-1)!.prompt).catalogAttached, false);
  app.setCatalog({ intent: "requested", scope: "selected", productSkus: ["UNKNOWN"] });
  const before = app.calls.length;
  await assert.rejects(() => app.exports.generateFlowAiReply(input), /unavailable catalog products/);
  assert.equal(app.calls.length, before + 1);
});

test("disabling catalog attachments avoids catalog planning, including with no products", async () => {
  const app = fixture();
  const result = await app.exports.generateFlowAiReply({ ...baseInput(), config: { ...blankStep("ai_auto_reply").config, attachCatalog: false }, productRows: [] });
  assert.equal(result.attachments.length, 0);
  assert.equal(app.calls.length, 1);
});

test("Chinese drafts are repaired once and persistent Chinese output is blocked before delivery", async () => {
  const app = fixture(); const input = baseInput();
  app.setBodies(["您好，请确认数量。", "Hi, please confirm your quantity."]);
  input.config.language = "zh-CN";
  input.messages[0].subject = "产品目录";
  const result = await app.exports.generateFlowAiReply(input);
  assert.equal(result.subject, "Synthetic subject");
  assert.match(result.body, /please confirm your quantity/);
  assert.match(result.body, /Best regards,/);
  assert.doesNotMatch(result.body, /\p{Script=Han}/u);
  assert.equal(app.calls.length, 3);
  app.setBodies(["您好，请确认数量。"]);
  await assert.rejects(() => app.exports.generateFlowAiReply(input), /non-English reply/);
});

test("an unavailable AI provider fails before any external request", async () => {
  const app = fixture(); delete app.env.GEMINI_API_KEY;
  await assert.rejects(() => app.exports.generateFlowAiReply({ config: blankStep("ai_auto_reply").config, productRows: [] }), /not configured/);
  assert.equal(app.calls.length, 0);
});
