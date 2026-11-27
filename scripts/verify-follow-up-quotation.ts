// Synthetic model qualification. No real customer reads, proposals saved or messages sent.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { createBudgetedAiFetch } from "../lib/ai/budget-fetch.ts";
import { resolveGatewayTokenAsync } from "../lib/ai/provider-credentials.ts";

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ syntheticOnly: true, businessWrites: false, cases: ["quotation advice", "direct quotation follow-up"], maximumProviderCalls: 12 }));
  process.exit(0);
}
const token = await resolveGatewayTokenAsync();
if (!token) throw new Error("Configured AI Gateway credentials are required.");
const id = "15693adc-0bdf-4617-b214-000000000001";
const company = { id, name: "Synthetic Hook Studio", fields: { name: "Synthetic Hook Studio", contactEmail: "buyer@example.test", country: "United States" } };
const product = { sku: "PLA-BASIC", name: "PLA Basic", currency: "USD", priceMinor: 800, moq: 1, variants: [{ id: "black", name: "Black", sku: "PLA-BLACK", priceMinor: 800 }] };
let calls = 0;
const transport: typeof fetch = async (url, init) => { if (++calls > 12) throw new Error("Synthetic provider-call limit reached."); return fetch(url, init); };
const fetcher = createBudgetedAiFetch(id, { reserve: async () => ({ allowed: true, reservationId: "synthetic" }), settle: async () => {} },
  async () => ({ input: .0000002, output: .00000075, context: 1000000, webSearch: 0 }), transport);
const results: Array<Record<string, unknown>> = [];
for (const scenario of ["Should I create a formal quotation for Synthetic Hook Studio?", "Can you prepare a draft quotation for Synthetic Hook Studio?"]) {
  const messages = [{ role: "user", content: "Find customers likely to order" }, { role: "assistant", content: `Synthetic Hook Studio requested pricing and warehouse pickup availability. [Customer](/companies/${id})` }, { role: "user", content: scenario }];
  const models = await nativeGatewayModels({ token, userId: id, userText: scenario, fetcher });
  const diagnostics: Array<{ kind: string; tools: string[]; message?: string }> = [];
  const plan = await generateCrmPlan({ ...models, messages, prompt: JSON.stringify({ CONVERSATION: messages, SERVER_DATA: { customerChoices: [company], products: [product] } }), pathname: "/", language: "en", signal: AbortSignal.timeout(60_000),
    read: async input => ({ records: input.resource === "products" ? [product] : [company], coverage: { matching: 1, nextOffset: null } }),
    searchEmails: async () => ({ messages: [{ id: "synthetic-email", companyId: id, direction: "inbound", text: "Please quote 500 black PLA Basic spools. What is available for warehouse pickup?", contentAvailable: true }], coverage: { nextOffset: null } }),
    validateAction: action => { assert.match(JSON.stringify(action), /create_quotation|create_catalog/); },
    onDiagnostic: event => diagnostics.push(event),
  });
  assert.ok(plan.output.trim());
  if (scenario.startsWith("Should I")) assert.equal(plan.actions.length, 0, "Advice does not authorize document creation");
  else assert.ok(plan.actions.some(action => action.type === "crm_action" && action.operation.op === "create_quotation" && action.operation.companyId === id), "A direct follow-up prepares the matched customer's quotation");
  results.push({ scenario, succeeded: true, proposedActions: plan.actions.map(action => action.type), clarification: plan.clarification?.question, diagnostics, output: plan.output });
  console.log(JSON.stringify(results.at(-1)));
}
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/quotation-follow-up-20261127.json", JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, businessWrites: false, providerCalls: calls, results }, null, 2) + "\n");
