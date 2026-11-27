/** Native tool-planning qualification against fictional records; never executes actions. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { resolveGatewayTokenAsync } from "../lib/ai/provider-credentials.ts";
import { evaluationBudget, evaluationRate } from "../lib/ai/evaluation-budget.ts";
import { createBudgetedAiFetch } from "../lib/ai/budget-fetch.ts";
import { agentCapabilities } from "../lib/ai/capabilities.ts";
import { dailyEvaluationData as data, dailyId } from "./daily-work-evaluation-cases.ts";
import { EXPERT_AI_MODEL } from "../lib/ai/model-routing.ts";

const cases = [
  { name: "order-reference-only", text: "Prepare an update to order PO-201 changing only its reference to PO-2026-2.", expected: "save_order" },
  { name: "invoice-quantity-conflict", text: "Review the remaining quantities on PO-201 and prepare an invoice only if the linked invoice records establish an unbilled quantity. Do not create another invoice when records conflict.", expected: null },
  { name: "issued-is-not-draft", text: "Check whether invoice INV-301 is a draft. Change its shipping to USD 39.50 only if it is still a draft; otherwise explain the blocker and do not modify it.", expected: null },
  { name: "missing-messenger-context", text: "Read this Messenger conversation and prepare a concise reply in its composer without sending.", expected: null },
];
if (!process.argv.includes("--live")) { console.log(JSON.stringify({ syntheticOnly: true, businessWrites: false, model: EXPERT_AI_MODEL, cases })); process.exit(0); }
const directory = "output/ai-daily-work-100/native-agent";
mkdirSync(directory, { recursive: true });
if (existsSync(`${directory}/report.json`)) appendFileSync(`${directory}/previous-runs.jsonl`, JSON.stringify(JSON.parse(readFileSync(`${directory}/report.json`, "utf8"))) + "\n");
const token = await resolveGatewayTokenAsync();
if (!token) throw new Error("AI Gateway credentials unavailable.");
const priceResponse = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15000) });
if (!priceResponse.ok) throw new Error("Pricing unavailable.");
const catalog = await priceResponse.json() as { data: Array<{ id: string } & Parameters<typeof evaluationRate>[0]> };
const price = catalog.data.find(row => row.id === EXPERT_AI_MODEL);
if (!price) throw new Error("Expert model unavailable.");
const rate = evaluationRate(price), budget = evaluationBudget(`${directory}/budget.json`);
const paidFetch = budget.fetch(async model => { assert.equal(model, EXPERT_AI_MODEL); return rate; });
// Isolated fake workspace wallet: actual provider spending is metered by paidFetch.
const fetcher = createBudgetedAiFetch(dailyId(90), { reserve: async () => ({ allowed: true, reservationId: "synthetic-only" }), settle: async () => {} }, async () => rate, paidFetch);
const company = data.companies[0], order = data.orders[0], invoice = data.invoices[0];
const results: Array<Record<string, unknown>> = [];
for (const scenario of cases) {
  const messages = [{ role: "user", content: scenario.text }];
  const models = await nativeGatewayModels({ token, userId: dailyId(90), userText: scenario.text, model: EXPERT_AI_MODEL, fetcher });
  const traces: unknown[] = [];
  const records = {
    companies: [company], orders: [order], invoices: [invoice], products: data.products, customer_insights: [company],
  } as Record<string, unknown[]>;
  try {
    const plan = await generateCrmPlan({ ...models, messages, pathname: "/companies", language: "en", signal: AbortSignal.timeout(90000),
      prompt: JSON.stringify({ CONVERSATION: messages, SERVER_DATA: { syntheticOnly: true, currentCompanyId: company.id, currentCompany: { id: company.id, fields: company }, currentEmail: data.emails[0], orders: [order], invoices: [invoice], products: data.products, note: "Read-only fictional qualification. No actions execute. The invoice is issued and its 300 units conflict with the order ledger's 100 invoiced units. No Messenger conversation is selected or provided; the selected email is a different channel." } }),
      onDiagnostic: event => traces.push(event),
      read: async input => ({ records: records[input.resource] ?? [], coverage: { included: (records[input.resource] ?? []).length, nextOffset: null } }),
      searchEmails: async () => ({ messages: [], coverage: { included: 0, nextOffset: null } }),
      validateAction: action => {
        const capability = agentCapabilities().find(row => row.name === (action.type === "crm_action" ? action.operation.op : action.type));
        assert.ok(capability);
        if (scenario.expected === null) throw new Error("The fictional invoice ledger/state blocks this action. Explain the conflict; no proposal is allowed.");
        assert.equal(action.type, "crm_action");
        if (action.type === "crm_action" && action.operation.op === "save_order") {
          assert.equal(action.operation.orderId, order.id);
          assert.deepEqual(action.operation.changes, { reference: "PO-2026-2" });
        } else throw new Error("Only the explicitly requested minimal order patch is allowed.");
      },
    });
    assert.equal(plan.actions.length, scenario.expected ? 1 : 0);
    if (!scenario.expected) assert.match(plan.output, scenario.name === "missing-messenger-context" ? /Messenger|conversation|message|select|open/i : /conflict|issued|discrepan|reconcil|not.*draft|block/i);
    results.push({ name: scenario.name, passed: true, plan, traces });
  } catch (error) { results.push({ name: scenario.name, passed: false, error: error instanceof Error ? error.message : "Native qualification failed", traces }); }
  writeFileSync(`${directory}/report.json`, JSON.stringify({ syntheticOnly: true, businessWrites: false, model: EXPERT_AI_MODEL, budget: budget.snapshot(), results }, null, 2) + "\n");
  console.log(JSON.stringify({ name: scenario.name, passed: results.at(-1)?.passed }));
}
if (results.some(row => !row.passed)) process.exitCode = 1;
