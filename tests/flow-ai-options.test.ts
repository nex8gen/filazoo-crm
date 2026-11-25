import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as replyPolicy from "../lib/ai/flow-reply.ts";
import * as leadIntake from "../lib/lead-intake.ts";
import { blankStep } from "../lib/flows.ts";
import { crmProduct } from "../lib/product-utils.ts";
import { invoiceProduct } from "../lib/invoice-links.ts";
import { buildCatalogPdf } from "../lib/catalog-pdf.ts";
import * as signatures from "../lib/ai/email-rewrite.ts";

const require = createRequire(import.meta.url);
type Row = Record<string, unknown>;
function fixture() {
  const calls: Array<{ prompt: string; systemInstruction: string; onGeneration?: (generation: { generationId: string; model: string; inputTokens: number; outputTokens: number; success: boolean }) => Promise<void> }> = [];
  const catalogRequests: Array<Parameters<typeof buildCatalogPdf>[0]> = [];
  const env: Record<string, string> = { AI_GATEWAY_API_KEY: "synthetic-test-key" };
  let catalogPlan = { intent: "none", scope: "all", productSkus: [] as string[] };
  let replyBodies = ["Hello from a synthetic test"];
  let gatewayError: string | null = null;
  let inquiryKind: "general" | "specific" = "specific";
  let replyAction = "reply";
  const exports = {} as { hasFlowReplyProvider: () => boolean; generateFlowAiReply: (input: Row) => Promise<{ subject: string; body: string; inReplyTo: string | null; attachments: Array<{ content: Buffer }> }>; prepareFlowAiReply: (input: Row) => Promise<unknown>; prepareFlowTemplateCatalog: () => Promise<Array<{ content: Buffer }>> };
  const reads: Array<{ table: string; filters: Record<string, unknown>; limit?: number }> = [];
  const tables: Record<string, Row[]> = {
    emails: [], contacts: [{ name: "Synthetic customer", email: "synthetic@example.com" }], companies: [{ name: "Synthetic company" }], workspace_members: [{ display_name: "Synthetic manager" }],
    email_reply_knowledge: [{ title: "Business policy", content: "A verified business fact." }], mailbox_sent_messages: [],
  };
  const from = (table: string) => {
    const read: typeof reads[number] = { table, filters: {} }; reads.push(read);
    let one = false;
    const query = { select: () => query, eq: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      or: (value: string) => { read.filters.ownerScope = value; return query; },
      in: (key: string, value: unknown) => { read.filters[key] = value; return query; },
      gte: (key: string, value: unknown) => { read.filters[`${key}>=`] = value; return query; },
      order: () => query, range: () => query, limit: (value: number) => { read.limit = value; return query; },
      single: () => { one = true; return query; }, maybeSingle: () => { one = true; return query; },
      throwOnError: async () => ({ data: one ? tables[table]?.[0] : tables[table] ?? [] }),
    }; return query;
  };
  const dependencies: Record<string, unknown> = {
    "../lead-intake.ts": leadIntake,
    "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) },
    "./flow-inquiry.ts": { loadFlowInquiry: async () => null },
    "./flow-mail-context.ts": { hydrateFlowMessages: async (messages: unknown) => messages },
    "./product-personalization.ts": { userProductRows: async (userId: string) => { assert.equal(userId, "synthetic-owner"); return productRows; } },
    "../auth.ts": { requireWorkspaceMember: async () => ({ id: "synthetic-owner" }) },
    "../product-utils.ts": { crmProduct },
    "../invoice-links.ts": { invoiceProduct },
    "../catalog-pdf-server.ts": { buildServerCatalogPdf: async (...args: Parameters<typeof buildCatalogPdf>) => { catalogRequests.push(args[0]); return buildCatalogPdf(...args); } },
    "../ai/gateway.ts": { generateGatewayText: async (input: typeof calls[number]) => {
      if (gatewayError) throw new Error(gatewayError);
      calls.push(input);
      await input.onGeneration?.({ generationId: `gen_${calls.length}`, model: "synthetic/model", inputTokens: 10, outputTokens: 2, success: true });
      if (input.systemInstruction.includes("Classify the customer's actual product inquiry")) return JSON.stringify({ kind: inquiryKind });
      if (JSON.parse(input.prompt).task === "select_catalog_products") return JSON.stringify(catalogPlan);
      const body = replyBodies.length > 1 ? replyBodies.shift()! : replyBodies[0];
      return JSON.stringify({ action: replyAction, subject: "Synthetic subject", body, quotes: [] });
    } },
    "../ai/flow-reply.ts": replyPolicy,
    "../ai/email-rewrite.ts": signatures,
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-ai-reply.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name] ?? require(name)), process: { env }, Buffer, Error, AbortSignal });
  return { calls, reads, tables, catalogRequests, exports, env, setAction: (action: string) => { replyAction = action; }, setInquiryKind: (kind: "general" | "specific") => { inquiryKind = kind; }, setProviderError: (message: string) => { gatewayError = message; }, setCatalog: (plan: typeof catalogPlan) => { catalogPlan = plan; }, setBodies: (bodies: string[]) => { replyBodies = [...bodies]; } };
}

const productRows = ["PLA", "PETG", "ABS"].map((material) => ({ sku: material, name: `Synthetic ${material}`, material,
  image_url: null, color: "Black", diameter: "1.75mm", weight: "1kg", price: 10, currency: "USD", moq: 1,
  stock_status: "In stock", lead_time: null, tags: [], active: true, sheet_updated_at: null }));
const baseInput = () => ({ config: blankStep("ai_auto_reply").config, contact: { name: "Synthetic customer", email: "synthetic@example.com" },
  company: { name: "Synthetic company" }, managerName: "Synthetic manager", productRows,
  messages: [{ subject: "Material inquiry", body: "Synthetic message", direction: "received", created_at: "2026-10-27T00:00:00Z", message_id: "<synthetic@example.com>", thread_id: "synthetic-thread" }], previousAutomatedMessages: 1 });

test("new-lead intake uses the approved introduction for general requests and AI only for specific questions", async () => {
  for (const kind of ["general", "specific"] as const) {
    const app = fixture(); app.setInquiryKind(kind);
    const input = baseInput(); input.previousAutomatedMessages = 3;
    input.config = { ...input.config, leadIntake: true, usePrices: false, attachCatalog: true, introductionTemplate: "Approved introduction. Which materials interest you?" };
    const result = await app.exports.generateFlowAiReply(input);
    assert.equal(result.attachments.length, 1);
    assert.match(result.body, kind === "general" ? /Approved introduction/ : /Hello from a synthetic test/);
    assert.equal(app.calls.some(call => call.systemInstruction.includes("Classify the customer's actual product inquiry")), true);
  }
});

test("billing follows every catalog, inquiry-classification and reply request", async () => {
  const app = fixture();
  const generations: string[] = [];
  await app.exports.generateFlowAiReply({ ...baseInput(), config: { ...baseInput().config, leadIntake: true, usePrices: false }, onGeneration: async (generation: { generationId: string }) => { generations.push(generation.generationId); } });
  assert.ok(app.calls.length >= 3);
  assert.equal(generations.length, app.calls.length);
  assert.equal(new Set(generations).size, generations.length);
});

test("AI flow readiness requires Gateway credentials and supports local OIDC", () => {
  const app = fixture();
  assert.equal(app.exports.hasFlowReplyProvider(), true);
  delete app.env.AI_GATEWAY_API_KEY;
  assert.equal(app.exports.hasFlowReplyProvider(), false);
  app.env.VERCEL_OIDC_TOKEN = "synthetic-oidc";
  assert.equal(app.exports.hasFlowReplyProvider(), true);
});

test("original form requirements reach both catalog planning and the email draft", async () => {
  const app = fixture();
  const inquiry = { source: "shopify", id: "original-form", receivedAt: "2026-11-10T07:00:00Z", fields: { "contact[Materials]": "PLA, PETG", "contact[Monthly volume]": "500–999 kg/month", "contact[Colors]": "black, white" } };
  await app.exports.generateFlowAiReply({ ...baseInput(), inquiry, config: { ...blankStep("ai_auto_reply").config, attachCatalog: true } });
  assert.equal(app.calls.length, 2);
  for (const call of app.calls) assert.deepEqual(JSON.parse(call.prompt).inquiry, inquiry);
});

test("Gateway authentication errors reach the caller without a direct-provider retry", async () => {
  const app = fixture();
  app.setProviderError("AI Gateway authentication has expired. Refresh the development token.");
  await assert.rejects(app.exports.generateFlowAiReply({ ...baseInput(), config: { ...blankStep("ai_auto_reply").config, attachCatalog: false } }), /authentication has expired/);
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
  const app = fixture(); delete app.env.AI_GATEWAY_API_KEY;
  await assert.rejects(() => app.exports.generateFlowAiReply({ config: blankStep("ai_auto_reply").config, productRows: [] }), /not configured/);
  assert.equal(app.calls.length, 0);
});

test("a questionnaire is repaired once; persistent extra questions never produce an email", async () => {
  const app = fixture(); const input = { ...baseInput(), config: { ...baseInput().config, attachCatalog: false } };
  app.setBodies(["Which material? Which color? What quantity?", "Hi, the PLA details are ready for review."]);
  assert.match((await app.exports.generateFlowAiReply(input)).body, /details are ready/);
  assert.equal(app.calls.length, 2);
  app.setBodies(["Which material? Which color?"]);
  await assert.rejects(app.exports.generateFlowAiReply(input), /too many customer questions/);
  assert.equal(app.calls.length, 4);
});

test("replies preserve long early requirements and distinguish quoted text from the latest acknowledgment", async () => {
  const app = fixture(); const input = baseInput();
  input.messages[0].body = "OK\n\n------------------ Original ------------------\nFrom: sales@example.test\nDate: Yesterday\nPlease send me a catalog.";
  input.messages.unshift({ ...input.messages[0], body: `Black PLA only ${"x".repeat(6500)} FINAL REQUIREMENT`, created_at: "2026-10-26T00:00:00Z" });
  await app.exports.generateFlowAiReply(input);
  const prompt = JSON.parse(app.calls.at(-1)!.prompt);
  assert.match(prompt.conversation[0].body, /FINAL REQUIREMENT$/);
  assert.equal(prompt.conversation[1].body, "OK");
  assert.match(prompt.conversation[1].quotedHistory, /send me a catalog/);
});

test("explicit catalog requests cannot silently become an email without the requested PDF", async () => {
  const app = fixture(); const input = baseInput(); input.messages[0].body = "Please send the PLA catalog.";
  app.setCatalog({ intent: "none", scope: "all", productSkus: [] });
  await assert.rejects(app.exports.generateFlowAiReply(input), /requested catalog was not selected/);
  assert.equal(app.calls.length, 2);
  assert.equal(app.catalogRequests.length, 0);
});

test("missing content, excessive context and model review/skip decisions fail closed before PDF preparation", async () => {
  const app = fixture();
  for (const action of ["skip", "review"]) {
    app.setAction(action); app.setBodies([""]);
    await assert.rejects(app.exports.generateFlowAiReply(baseInput()), /no further automatic reply|manual review/);
  }
  await assert.rejects(app.exports.generateFlowAiReply({ ...baseInput(), messages: [{ ...baseInput().messages[0], body_loaded: false }] }), /complete conversation content/);
  await assert.rejects(app.exports.generateFlowAiReply({ ...baseInput(), messages: [{ ...baseInput().messages[0], body: "x".repeat(250001) }] }), /context limit/);
  assert.equal(app.catalogRequests.length, 0);
});

test("preparation reads beyond 12 messages, approved facts and actual catalog files with customer/owner scope", async () => {
  const app = fixture();
  app.tables.emails = Array.from({ length: 16 }, (_, index) => ({ ...baseInput().messages[0], id: `msg-${index}`, message_id: `<msg-${index}@example.test>`, direction: index % 2 ? "sent" : "received", created_at: new Date(Date.UTC(2026, 10, 24, 0, index)).toISOString() }));
  app.tables.mailbox_sent_messages = [{ message_id: "<msg-1@example.test>", attachments: [{ filename: "footer.png", cid: "footer" }] }];
  const args = { userId: "synthetic-owner", contactId: "synthetic-contact", companyId: "synthetic-company", conversationId: "thread-1", config: { ...blankStep("ai_auto_reply").config, usePrices: false } };
  await app.exports.prepareFlowAiReply(args);
  const prompt = JSON.parse(app.calls.at(-1)!.prompt);
  assert.equal(prompt.conversation.length, 16);
  assert.deepEqual(prompt.approvedBusinessFacts.records, app.tables.email_reply_knowledge);
  assert.equal(JSON.parse(app.calls[0].prompt).previouslyDeliveredCatalogs, 0);
  assert.equal(JSON.parse(app.calls[0].prompt).firstAutomatedMessage, true);
  const emailRead = app.reads.find(read => read.table === "emails")!;
  assert.equal(emailRead.limit, 201);
  assert.equal(emailRead.filters.thread_id, "thread-1");
  assert.equal(emailRead.filters.ownerScope, "owner_id.is.null,owner_id.eq.synthetic-owner");
  assert.equal(app.reads.find(read => read.table === "contacts")!.filters.company_id, "synthetic-company");
  const deliveryRead = app.reads.find(read => read.table === "mailbox_sent_messages")!;
  assert.equal(deliveryRead.filters.user_id, "synthetic-owner");
  assert.equal(deliveryRead.filters.to_email, "synthetic@example.com");
  app.tables.mailbox_sent_messages.push({ message_id: "<msg-3@example.test>", attachments: [{ filename: "Filazoo-product-catalog.pdf" }] });
  await app.exports.prepareFlowAiReply(args);
  assert.equal(JSON.parse(app.calls.at(-2)!.prompt).previouslyDeliveredCatalogs, 1);
});

test("new-lead context excludes mail predating enrollment and excessive history never silently drops early requirements", async () => {
  const app = fixture();
  const args = { userId: "synthetic-owner", contactId: "synthetic-contact", companyId: "synthetic-company", conversationId: "lead:synthetic", inquiryBefore: "2026-11-24T01:00:00Z", config: { ...blankStep("ai_auto_reply").config, attachCatalog: false } };
  await app.exports.prepareFlowAiReply(args);
  assert.equal(app.reads.find(read => read.table === "emails")!.filters["created_at>="], args.inquiryBefore);
  app.tables.emails = Array.from({ length: 201 }, () => ({ ...baseInput().messages[0] }));
  await assert.rejects(app.exports.prepareFlowAiReply(args), /complete-context limit/);
});
