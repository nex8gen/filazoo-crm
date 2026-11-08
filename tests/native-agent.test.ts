import test from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { agentCapabilities } from "../lib/ai/capabilities.ts";
import { assertDocumentIntent, requestedDocumentKinds } from "../lib/ai/document-intent.ts";
import { aiActionRequirements, aiReadResources } from "../lib/ai-policy.ts";
import { crmReadSchema, crmOperationSchema } from "../lib/ai/crm-tools.ts";
import { quoteAiBudget } from "../lib/ai/budget.ts";
import { portableToolSchema } from "../lib/ai/tool-schema.ts";
import { groundInvoiceEmailIntent } from "../lib/ai/agent-actions.ts";
import { assertWorkflowCoverage } from "../lib/ai/workflow-contract.ts";

const id = "15693adc-0bdf-4617-b214-71b1861764a9";
const result = (...calls: Array<[string, unknown]>): LanguageModelV4GenerateResult => ({ content: calls.map(([toolName, input], index) => ({ type: "tool-call", toolName, toolCallId: `call-${index}`, input: JSON.stringify(input) })), finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } }, warnings: [] });
const options = (model: MockLanguageModelV4, text = "create a quotation for this customer") => ({ model, prompt: text, messages: [{ role: "user", content: text }], pathname: "/companies", language: "en", read: async () => ({ records: [{ id, name: "Synthetic Company" }] }), searchEmails: async () => ({ records: [] }), validateAction: () => {} });

test("portable function schemas keep blank fields usable across providers without weakening CRM validation", () => {
  const capability = agentCapabilities().find(value => value.name === "update_company")!;
  const schema = portableToolSchema(capability.inputSchema);
  assert.doesNotMatch(JSON.stringify(schema), /"(?:enum|const)":(?:\[""\]|"")/);
  assert.throws(() => capability.action({ type: "update_company", companyId: "invented", changes: { name: "Synthetic" } }));
  const settings = crmOperationSchema.parse({ op: "update_ai_settings", changes: { actions: { invoices: "deny" } } });
  assert.equal(settings.op, "update_ai_settings");
  if (settings.op === "update_ai_settings") assert.equal(settings.changes.actions?.tagging, undefined);
});

test("a draft request cannot become an email send, and prepared task work checks dependent permissions", () => {
  const action = { type: "write_email" as const, email: { to: "buyer@example.com", subject: "Quotation", text: "Attached.", delivery: "send" as const } };
  const grounded = groundInvoiceEmailIntent(action, { messages: [{ role: "user", content: "quotation attached to a emial draft" }] });
  assert.ok("email" in grounded); if ("email" in grounded) assert.equal(grounded.email?.delivery, "draft");
  const required = aiActionRequirements({ type: "crm_action", operation: { op: "task_workflow_action", input: { action: "prepare" } } });
  assert.ok(required.actions.includes("invoices")); assert.ok(required.actions.includes("emailDrafts"));
});

test("every executable capability has a typed schema, domain and fail-closed policy", () => {
  const capabilities = agentCapabilities();
  assert.equal(new Set(capabilities.map(value => value.name)).size, capabilities.length);
  assert.equal(capabilities.length, crmOperationSchema.options.length + 10);
  for (const capability of capabilities) {
    assert.ok(capability.description.length > 20);
    const action = capability.inputSchema === undefined ? {} : capability.name;
    const requirements = aiActionRequirements(capability.name === "run_workflow" ? { type: "run_workflow", steps: [{ tool: "create_task", input: {} }, { tool: "create_task", input: {} }] } : capability.name === "write_email" ? { type: "write_email", email: { delivery: "draft" } } : { type: "crm_action", operation: { op: String(action) } });
    assert.ok(requirements.actions.length > 0);
  }
  for (const resource of crmReadSchema.shape.resource.options) assert.ok(aiReadResources[resource]?.length);
});

test("catalog is an alias for quotation, and neither can silently become an invoice", () => {
  for (const name of ["quotation", "qatation", "quatation", "cotation", "catalog", "catelog"]) {
    const context = { messages: [{ role: "user", content: `create a ${name} for Abe` }, { role: "assistant", content: "Which color?" }, { role: "user", content: "Black, 500" }] };
    assert.deepEqual(requestedDocumentKinds(context), ["quotation"]);
    assert.throws(() => assertDocumentIntent([{ type: "create_invoice", companyId: id, items: [{ productSku: "PLA", quantity: 500 }] }], context), /different document/);
    assert.doesNotThrow(() => assertDocumentIntent([{ type: "crm_action", operation: { op: "create_catalog", companyId: id, currency: "USD", productSkus: [] } }], context));
  }
  assert.deepEqual(requestedDocumentKinds({ messages: [{ role: "user", content: "make a quote not an invoice" }] }), ["quotation"]);
  assert.doesNotThrow(() => assertDocumentIntent([{ type: "create_invoice", companyId: id, items: [{ productSku: "PLA", quantity: 500 }] }], { messages: [{ role: "user", content: "create an invoice from this accepted quotation" }] }));
});

test("native SDK reads real records then stages a quotation without a business write", async () => {
  const model = new MockLanguageModelV4({ doGenerate: [result(["read_records", { resource: "companies", query: "Abe" }]), result(["create_quotation", { op: "create_quotation", companyId: id }])] });
  let reads = 0, validations = 0;
  const plan = await generateCrmPlan({ ...options(model), read: async () => { reads++; return { records: [{ id, name: "Synthetic" }] }; }, validateAction: () => { validations++; } });
  assert.equal(reads, 1); assert.equal(validations, 1); assert.equal(plan.actions.length, 1);
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal(plan.actions[0].type, "crm_action");
  assert.match(JSON.stringify(plan.actions), /create_quotation/);
  assert.doesNotMatch(JSON.stringify(plan.actions), /invoice/);
  assert.equal(model.doGenerateCalls[0].providerOptions?.openai?.store, false);
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /REQUEST CONTEXT PRIORITY/);
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /The page is context, not a restriction/);
});

test("failed or mixed native tool batches cannot leak partial proposals", async () => {
  const valid = ["create_quotation", { op: "create_quotation", companyId: id }] as [string, unknown];
  for (const bad of [["create_quotation", { op: "create_quotation", companyId: "invented" }], ["read_records", { resource: "products", query: "PLA" }]] as Array<[string, unknown]>) {
    const model = new MockLanguageModelV4({ doGenerate: [result(valid, bad), { ...result(), content: [{ type: "text", text: "Ready" }], finishReason: { unified: "stop", raw: "stop" } }] });
    const plan = await generateCrmPlan(options(model));
    assert.equal(plan.actions.length, 0); assert.match(plan.output, /No actions were prepared/);
  }
});

test("native clarification produces no action, and denied policy cannot stage an action", async () => {
  const questionModel = new MockLanguageModelV4({ doGenerate: result(["ask_question", { question: "Which saved color should I use?" }]) });
  const plan = await generateCrmPlan(options(questionModel));
  assert.equal(plan.actions.length, 0); assert.match(plan.clarification!.question, /color/);
  const denied = new MockLanguageModelV4({ doGenerate: result(["create_quotation", { op: "create_quotation", companyId: id }]) });
  const deniedPlan = await generateCrmPlan({ ...options(denied), validateAction: () => { throw new Error("Workspace policy denies this action"); } });
  assert.equal(deniedPlan.actions.length, 0);
});

test("async business validation reaches the repair model before any proposal can be staged", async () => {
  const action = result(["create_quotation", { op: "create_quotation", companyId: id }]);
  const initial = new MockLanguageModelV4({ doGenerate: action });
  const repair = new MockLanguageModelV4({ doGenerate: [result(["read_records", { resource: "products", query: "PLA" }]), action] });
  let validations = 0;
  const plan = await generateCrmPlan({ ...options(initial), repairModel: repair, validateAction: async () => {
    await Promise.resolve();
    if (++validations === 1) throw new Error("The selected product variant is unavailable; look up its current SKU.");
  } });
  assert.equal(validations, 2);
  assert.equal(plan.actions.length, 1);
  assert.equal(initial.doGenerateCalls.length, 1);
  assert.equal(repair.doGenerateCalls.length, 2);
  assert.match(JSON.stringify(repair.doGenerateCalls[0].prompt), /selected product variant is unavailable/);
});

test("a compound request cannot stop at an order-only proposal; the repair step receives the missing goals", async () => {
  const request = "Create an order for 100 black PLA and send the draft invoice email with its PDF attached.";
  const partial = result(["create_invoice", { type: "create_invoice", companyId: id, items: [{ productSku: "PLA", quantity: 100 }] }]);
  const complete = result(["create_order", { type: "create_order", companyId: id, items: [{ productSku: "PLA", quantity: 100 }], email: { to: "buyer@example.com", subject: "Invoice", text: "Attached for review.", delivery: "send" } }]);
  const model = new MockLanguageModelV4({ doGenerate: [partial, complete] });
  const plan = await generateCrmPlan(options(model, request));
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal(plan.actions.length, 1); assert.equal(plan.actions[0].type, "create_order");
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /AND its invoice email/);
});

test("sending a draft invoice differs from drafting an email, including explicit no-send instructions", () => {
  const action = { type: "create_order" as const, companyId: id, items: [{ productSku: "PLA", quantity: 100 }], email: { to: "buyer@example.com", subject: "Invoice", text: "Attached.", delivery: "send" as const } };
  for (const [content, expected] of [["Create an order and send the draft invoice email.", "send"], ["Create an order and prepare an email draft. Do not send.", "draft"], ["Create an order and write an email, then send it.", "send"]]) {
    const grounded = groundInvoiceEmailIntent(action, { messages: [{ role: "user", content }] });
    assert.ok("email" in grounded); if ("email" in grounded) assert.equal(grounded.email?.delivery, expected);
  }
});

test("provider-escaped email paragraphs become readable text before review", () => {
  const capability = agentCapabilities().find(value => value.name === "create_order")!;
  const action = capability.action({ type: "create_order", companyId: id, items: [{ productSku: "PLA", quantity: 100 }], email: { to: "buyer@example.com", subject: "Invoice", text: "Hello,\\n\\nYour invoice is attached.", delivery: "draft" } });
  assert.ok("email" in action);
  if ("email" in action) assert.equal(action.email?.text, "Hello,\n\nYour invoice is attached.");
});

test("completion validation does not demand a duplicate order for a saved-order invoice email", () => {
  assert.doesNotThrow(() => assertWorkflowCoverage([{ type: "send_invoice", invoiceId: id, email: { to: "buyer@example.com", subject: "Invoice", text: "Attached.", delivery: "draft" } }], { messages: [{ role: "user", content: "Create a draft invoice from this saved purchase order and prepare an email draft with the PDF attached." }] }));
});

test("native function schemas are metered; provider-side tools remain blocked", () => {
  const rate = { input: .0000002, output: .00000075, context: 1000000, webSearch: .01 };
  const body = { model: "google/gemini-3.5-flash-lite", input: "Synthetic", max_output_tokens: 1000, tools: [{ type: "function", name: "create_quotation", parameters: { type: "object", properties: {} } }] };
  assert.equal(quoteAiBudget(body, rate).webCalls, 0);
  assert.throws(() => quoteAiBudget({ ...body, tools: [{ type: "computer_use" }] }, rate));
});

test("Gateway SDK ignores legacy allowances and keeps storage off, bounded output and real function schemas", async () => {
  const previous = process.env.AI_BUDGET_ENFORCEMENT; process.env.AI_BUDGET_ENFORCEMENT = "true";
  try {
    let payload: Record<string, unknown> = {};
    const models = await nativeGatewayModels({ token: "synthetic", userId: id, userText: "create a quotation", fetcher: async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ id: "resp-synthetic", created_at: 1, model: "google/gemini-3.5-flash-lite", status: "completed", output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "create_quotation", arguments: JSON.stringify({ op: "create_quotation", companyId: id }) }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 0 } } });
    } });
    const plan = await generateCrmPlan({ ...options(new MockLanguageModelV4()), ...models });
    assert.equal(plan.actions.length, 1); assert.equal(payload.store, false); assert.equal(payload.max_output_tokens, 5000);
    assert.ok(Array.isArray(payload.tools)); assert.equal(payload.stream, undefined);
    assert.deepEqual(payload.reasoning, { effort: "low" });
  } finally { if (previous === undefined) delete process.env.AI_BUDGET_ENFORCEMENT; else process.env.AI_BUDGET_ENFORCEMENT = previous; }
});

test("Gateway order planning uses native action tools and shared authentication", async () => {
  let payload: Record<string, unknown> = {};
  const models = await nativeGatewayModels({ token: "synthetic", userId: id, userText: "create an order", fetcher: async (url, init) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v1/responses");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic");
    payload = JSON.parse(String(init?.body));
    return Response.json({ id: "resp-order", created_at: 1, status: "completed", model: "google/gemini-3.5-flash-lite", output: [{ type: "function_call", id: "fc-order", call_id: "call-order", name: "create_order", arguments: JSON.stringify({ companyId: id, items: [{ productSku: "PLA", variantId: "black", quantity: 100 }] }) }], usage: { input_tokens: 20, output_tokens: 10 } });
  } });
  const plan = await generateCrmPlan({ ...options(new MockLanguageModelV4(), "create an order with 100 black PLA"), ...models });
  assert.equal(plan.actions[0]?.type, "create_order");
  assert.ok(Array.isArray(payload.tools));
  assert.doesNotMatch(JSON.stringify(payload.input), /FILAZOO_ACTIONS_JSON/);
});
