import test from "node:test";
import assert from "node:assert/strict";
import { aiTextEvaluationCases } from "../scripts/ai-text-evaluation-cases.ts";
import { syntheticServerData, syntheticRead, evaluationCases, checkEvaluation } from "../scripts/agent-evaluation-cases.ts";
import type { NativeAgentPlan } from "../lib/ai/native-agent.ts";
import { buildEmailReplyInstruction } from "../lib/ai/email-reply.ts";
import { replyWorkInstruction } from "../lib/task-workflows.ts";
import { defaultFlowInput } from "../lib/flows.ts";

const outputs: Record<string, string> = {
  "ai-chat:grounded-customer": "Synthetic Printing is in the United States; its contact is Abe M. [P]",
  "ai-chat:missing-billing": "Billing is not available to your role. I cannot mark an invoice paid in chat.",
  "ai-email:reply-invoice": JSON.stringify({ body: "Hi Abe, your draft invoice is ready for review.", attachCatalog: false, invoiceItems: [{ productSku: "PLA-BASIC", variantId: "black", quantity: 500 }] }),
  "ai-email:rewrite-facts": "Hi Abe, we can prepare a draft invoice for 500 Black PLA Basic spools. Please share your delivery address. Best regards, Synthetic Manager",
  "ai-email:summary": JSON.stringify({ title: "Invoice request", summary: "Abe requests 500 Black PLA Basic spools.", nextStep: "Prepare a draft for review.", followUpAt: null, followUpReason: "No follow-up scheduled." }),
  "ai-workflow:no-invented-price": JSON.stringify({ subject: "PLA information", body: "Hi Abe, a sales colleague will confirm the price for your requirements.", quotes: [] }),
  "ai-workflow:catalog-scope": JSON.stringify({ intent: "requested", scope: "selected", productSkus: ["PLA-BASIC"] }),
  "ai-tagging:buyer-inquiry": JSON.stringify({ tag: "New Inquiries", confidence: .95, reason: "Buyer asks about filament.", evidence: [{ messageKey: "synthetic-inquiry", quote: "We are looking for PLA filament for our print farm." }] }),
  "ai-task:reply-extraction": JSON.stringify({ summary: "Address supplied.", changes: { shippingAddress: "123 Example Street, Boston, MA 02101, United States" }, items: [], missing: [], subject: "Address received", text: "Thank you for your delivery address." }),
};
for (const scenario of aiTextEvaluationCases()) test(`${scenario.name}: accepts grounded output with production parser`, () => {
  assert.ok(scenario.text); assert.ok(scenario.text.instruction.length > 100);
  assert.equal(scenario.text.check(outputs[scenario.name]), true);
});
test("AI checks reject fabricated catalog scope, unsupported tagging evidence and guessed invoice quantities", () => {
  const scenarios = aiTextEvaluationCases();
  const check = (name: string, output: unknown) => scenarios.find(value => value.name === name)!.text!.check(JSON.stringify(output));
  assert.equal(check("ai-workflow:catalog-scope", { intent: "requested", scope: "all", productSkus: [] }), false);
  assert.throws(() => check("ai-tagging:buyer-inquiry", { tag: "New Inquiries", confidence: .95, reason: "Inquiry", evidence: [{ messageKey: "synthetic-inquiry", quote: "The buyer accepted every price." }] }));
  assert.equal(check("ai-email:reply-invoice", { body: "Ready", attachCatalog: false, invoiceItems: [{ productSku: "PLA-BASIC", variantId: "black", quantity: 900 }] }), false);
});
test("synthetic record reads respect queried names and provide actionable current revisions", () => {
  const data = syntheticServerData();
  assert.equal(syntheticRead({ resource: "companies", query: "Synthetic New Customer", offset: 0 }, data, "capability:create_company").records.length, 0);
  assert.equal(syntheticRead({ resource: "products", query: "Mystery TPU", offset: 0 }, data, "unknown").records.length, 0);
  const records = syntheticRead({ resource: "task_workflows", query: "", offset: 0 }, data, "task").records as Array<{ revision: number }>;
  assert.equal(records[0].revision, 1);
});
test("partial field evaluation rejects unrequested profile edits and execution claims even without proposals", () => {
  const scenario = evaluationCases().find(value => value.name === "capability:update_company")!;
  const plan = { output: "Ready", actions: [{ type: "update_company", companyId: syntheticServerData().currentCompanyId, changes: { city: "Boston", country: "Canada" } }], contractVersion: "synthetic" } as NativeAgentPlan;
  assert.ok(checkEvaluation(plan, scenario).some(value => /unrequested/.test(value)));
  assert.ok(checkEvaluation({ ...plan, output: "I deleted the customer.", actions: [] }, { ...scenario, expected: undefined, noActions: true }).some(value => /Claimed execution/.test(value)));
});
test("quotation checking accepts equivalent saved-price lines only for the verified product, variant and quantity", () => {
  const scenario = evaluationCases().find(value => value.name === "capability:create_quotation")!;
  const plan = { output: "Ready for review", actions: [{ type: "crm_action", operation: { op: "create_quotation", companyId: syntheticServerData().currentCompanyId, productSkus: [], items: [{ productSku: "PLA-BASIC", variantId: "black", quantity: 500, pricingMode: "saved" }] } }], contractVersion: "synthetic" } as NativeAgentPlan;
  assert.deepEqual(checkEvaluation(plan, scenario), []);
  const wrong = structuredClone(plan);
  if (wrong.actions[0].type === "crm_action" && wrong.actions[0].operation.op === "create_quotation") wrong.actions[0].operation.items![0].quantity = 900;
  assert.ok(checkEvaluation(wrong, scenario).length);
  const changedPrice = structuredClone(plan);
  if (changedPrice.actions[0].type === "crm_action" && changedPrice.actions[0].operation.op === "create_quotation") {
    changedPrice.actions[0].operation.items![0].pricingMode = "agreed";
    changedPrice.actions[0].operation.items![0].unitPriceMinor = 1;
  }
  assert.ok(checkEvaluation(changedPrice, scenario).length);
});
test("new invoice evaluation permits its saved currency default without treating creation as a partial edit", () => {
  const scenario = evaluationCases().find(value => value.name === "money:invoice")!;
  const action = structuredClone(scenario.expected) as NativeAgentPlan["actions"][number];
  if (action.type !== "create_invoice") throw new Error("Wrong fixture");
  action.details = { ...action.details, currency: "USD" };
  assert.deepEqual(checkEvaluation({ output: "Ready", actions: [action], contractVersion: "synthetic" }, scenario), []);
});
test("quotation attachment evaluation accepts the verified saved PDF and rejects a guessed document or added invoice", () => {
  const scenario = evaluationCases().find(value => value.name === "email:quotation-draft")!;
  const action = { type: "write_email" as const, email: { to: "abe@example.com", subject: "Quotation", text: "Please review the saved quotation.", delivery: "draft" as const, quotationId: syntheticServerData().currentCompanyId } };
  const plan = { output: "Ready", actions: [action], contractVersion: "synthetic" };
  assert.deepEqual(checkEvaluation(plan, scenario), []);
  assert.ok(checkEvaluation({ ...plan, actions: [{ ...action, invoiceId: syntheticServerData().currentCompanyId }] }, scenario).length);
  assert.ok(checkEvaluation({ ...plan, actions: [{ ...action, email: { ...action.email, quotationId: "25693adc-0bdf-4617-b214-71b1861764a9" } }] }, scenario).length);
});
test("live reply regressions distinguish parent SKUs, latest addresses and required acknowledgment fields", () => {
  const instruction = buildEmailReplyInstruction();
  assert.match(instruction, /TOP-LEVEL product.sku, never a variant's sku/);
  assert.match(instruction, /latest customer message supersedes an older saved profile address/);
  assert.match(replyWorkInstruction, /subject and text must always be nonempty, including customer_details/);
});
test("address evaluation uses production grounding and accepts multiline formatting without accepting invented address facts", () => {
  const check = aiTextEvaluationCases().find(value => value.name === "ai-task:reply-extraction")!.text!.check;
  const plan = JSON.parse(outputs["ai-task:reply-extraction"]);
  plan.changes.shippingAddress = "123 Example Street\nBoston, MA 02101\nUnited States";
  assert.equal(check(JSON.stringify(plan)), true);
  plan.changes.shippingAddress = "123 Example Street, Apt 99, Boston, MA 02101, United States";
  assert.equal(check(JSON.stringify(plan)), false);
});
test("workflow rename evaluation accepts unchanged saved configuration but rejects an unrequested timing change", () => {
  const scenario = evaluationCases().find(value => value.name === "capability:update_flow")!;
  const plan = { output: "Ready", actions: [{ type: "crm_action", operation: { op: "update_flow", flowId: syntheticServerData().currentCompanyId, changes: { ...structuredClone(defaultFlowInput), name: "Revised sample follow-up" } } }], contractVersion: "synthetic" } as NativeAgentPlan;
  assert.deepEqual(checkEvaluation(plan, scenario), []);
  if (plan.actions[0].type === "crm_action" && plan.actions[0].operation.op === "update_flow") plan.actions[0].operation.changes.steps![0].config.amount = 7;
  assert.ok(checkEvaluation(plan, scenario).some(reason => /unrequested/.test(reason)));
});
test("structured text evaluations retain production JSON schemas and catalog inputs exclude variant SKUs", () => {
  const cases = aiTextEvaluationCases();
  for (const name of ["ai-tagging:buyer-inquiry", "ai-task:reply-extraction"]) assert.ok(cases.find(value => value.name === name)!.text!.responseJsonSchema?.properties);
  const catalog = JSON.parse(cases.find(value => value.name === "ai-workflow:catalog-scope")!.text!.prompt);
  assert.deepEqual(catalog.products.map((value: { sku: string }) => value.sku), ["PLA-BASIC", "PETG-BASIC"]);
  assert.ok(catalog.products.every((value: Record<string, unknown>) => !value.variants));
});
