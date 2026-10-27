import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as replyPolicy from "../lib/ai/flow-reply.ts";
import { blankStep } from "../lib/flows.ts";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
function fixture() {
  const calls: Array<{ prompt: string; systemInstruction: string }> = [];
  const env: Record<string, string> = { GEMINI_API_KEY: "synthetic-test-key" };
  const product = { sku: "PLA", name: "Synthetic PLA", currency: "USD", priceMinor: 1000, moq: 1, tiers: [], variants: [] };
  const exports = {} as { generateFlowAiReply: (input: Row) => Promise<{ subject: string; body: string; inReplyTo: string | null; attachments: unknown[] }> };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../supabase/admin.ts": {},
    "../product-utils.ts": { crmProduct: () => product },
    "../invoice-links.ts": { invoiceProduct: () => product },
    "../catalog-pdf.ts": { buildCatalogPdf: () => Buffer.from("%PDF-synthetic-catalog") },
    "../ai/gemini.ts": { generateGeminiText: async (input: typeof calls[number]) => { calls.push(input); return JSON.stringify({ subject: "Synthetic subject", body: "Hello from a synthetic test", quotes: [] }); } },
    "../ai/gateway.ts": {}, "../ai/flow-reply.ts": replyPolicy,
    "../ai/email-rewrite.ts": { applyEmailSignature: (body: string) => `${body}\nSynthetic manager`, DEFAULT_EMAIL_TITLE: "Sales", DEFAULT_EMAIL_COMPANY: "Synthetic company" },
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-ai-reply.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), process: { env }, Buffer });
  return { calls, exports, env };
}

test("AI product, price, catalog, first-message, language, instructions and threading options reach generation", async () => {
  const app = fixture();
  let checked = 0;
  for (const [useProducts, usePrices] of [[false, false], [true, false], [true, true]])
    for (const attachCatalog of [false, true]) for (const firstOnly of [false, true])
      for (const previous of [0, 1]) for (const language of ["auto", "en", "zh-CN"])
        for (const replyInThread of [false, true]) {
          const config = { ...blankStep("ai_auto_reply").config, useProducts, usePrices, attachCatalog, catalogFirstMessageOnly: firstOnly, language, replyInThread, instructions: "Ask about required quantity" };
          const result = await app.exports.generateFlowAiReply({ config, contact: { name: "Synthetic customer", email: "synthetic@example.com" }, company: { name: "Synthetic company" }, managerName: "Synthetic manager",
            messages: [{ subject: "Material inquiry", body: "Synthetic message", direction: "received", created_at: "2026-10-27T00:00:00Z", message_id: "<synthetic@example.com>", thread_id: "synthetic-thread" }], productRows: [{}], previousAutomatedMessages: previous });
          const input = app.calls.at(-1)!;
          const prompt = JSON.parse(input.prompt);
          assert.equal(prompt.products.length, useProducts ? 1 : 0);
          if (useProducts) assert.equal(Object.hasOwn(prompt.products[0], "pricing"), usePrices);
          assert.equal(prompt.managerGuidance, config.instructions);
          assert.equal(result.attachments.length, attachCatalog && (!firstOnly || previous === 0) ? 1 : 0);
          assert.equal(result.inReplyTo, replyInThread ? "<synthetic@example.com>" : null);
          assert.equal(result.subject, replyInThread ? "Re: Material inquiry" : "Synthetic subject");
          assert.match(input.systemInstruction, language === "en" ? /Write in English/ : language === "zh-CN" ? /Write in Simplified Chinese/ : /language of the latest customer email/);
          checked++;
        }
  assert.equal(checked, 144);
});

test("an unavailable AI provider fails before any external request", async () => {
  const app = fixture(); delete app.env.GEMINI_API_KEY;
  await assert.rejects(() => app.exports.generateFlowAiReply({ config: blankStep("ai_auto_reply").config, productRows: [] }), /not configured/);
  assert.equal(app.calls.length, 0);
});
