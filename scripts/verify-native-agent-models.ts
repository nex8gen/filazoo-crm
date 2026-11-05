import { mkdirSync, writeFileSync } from "node:fs";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { quoteAiBudget, chargedAiBudget, type BudgetRate } from "../lib/ai/budget.ts";
import { STANDARD_AI_MODEL, COMPLEX_AI_MODEL } from "../lib/ai/model-routing.ts";

const companyId = "15693adc-0bdf-4617-b214-71b1861764a9";
const cases = [
  { name: "quotation-selection", messages: [{ role: "user", content: "can you create a quotation for this customer" }], check: (actions: unknown[]) => /create_quotation/.test(JSON.stringify(actions)) && !/create_invoice/.test(JSON.stringify(actions)) },
  { name: "legacy-catalog-name", messages: [{ role: "user", content: "can you create catelog for this costomer" }], check: (actions: unknown[]) => /create_quotation|create_catalog/.test(JSON.stringify(actions)) && !/create_invoice/.test(JSON.stringify(actions)) },
  { name: "quotation-email-followup", messages: [{ role: "user", content: "create quotation for this customer" }, { role: "assistant", content: "Download or email draft?" }, { role: "user", content: "quotation attached to a emial draft" }], check: (actions: unknown[]) => actions.length === 1 && /write_email/.test(JSON.stringify(actions)) && /"attachCatalog":true/.test(JSON.stringify(actions)) && /"delivery":"draft"/.test(JSON.stringify(actions)) },
  { name: "invoice-from-history", messages: [{ role: "user", content: "create a invoice for Abe M for PLA Basic 500 qty in Black" }], check: (actions: unknown[]) => actions.length === 1 && /create_invoice/.test(JSON.stringify(actions)) && /"quantity":500/.test(JSON.stringify(actions)) && !/"email":/.test(JSON.stringify(actions)) },
];
if (!process.argv.includes("--live")) { console.log(JSON.stringify({ models: [STANDARD_AI_MODEL, COMPLEX_AI_MODEL], cases: cases.map(value => value.name), syntheticOnly: true, maximumQuotedUsd: .10 })); process.exit(0); }
const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
if (!token) throw new Error("A configured Gateway credential is required.");
process.env.AI_BUDGET_ENFORCEMENT = "false"; // Isolated synthetic evaluation has its own strict cap; no workspace data or writes.
const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error("Unable to load current Gateway prices.");
const catalog = (await response.json()).data as Array<{ id: string; pricing: { input: string; output: string; input_cache_write?: string } }>;
let reserved = 0, charged = 0;
const results: Array<Record<string, unknown>> = [];
for (const model of [STANDARD_AI_MODEL, COMPLEX_AI_MODEL]) {
  const price = catalog.find(value => value.id === model)?.pricing;
  if (!price) throw new Error("Model is absent from the current catalog.");
  const rate: BudgetRate = { input: Math.max(Number(price.input), Number(price.input_cache_write ?? price.input)), output: Number(price.output), context: 1000000, webSearch: 0 };
  process.env.AI_GATEWAY_COMPLEX_MODEL = model; process.env.AI_GATEWAY_STANDARD_MODEL = model;
  for (const scenario of cases) {
    const started = performance.now();
    const fetcher: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      const quote = quoteAiBudget(body, rate);
      if (charged + quote.reservedMicros > 100000) throw new Error("Synthetic evaluation cost cap reached.");
      reserved += quote.reservedMicros;
      let actual = quote.reservedMicros;
      try {
        const response = await fetch(url, init);
        actual = chargedAiBudget(await response.clone().json(), rate, quote, response.status);
        return response;
      } finally { charged += actual; }
    };
    try {
      const userText = scenario.messages.map(message => message.content).join("\n");
      const models = await nativeGatewayModels({ token, userId: companyId, model, userText, fetcher });
      const serverData = { currentCompanyId: companyId, currentCompany: { fields: { name: "Synthetic Printing", contactName: "Abe M", contactEmail: "abe@example.com", country: "United States", commerce: { billingAddress: "123 Example Street", shippingAddress: "123 Example Street" } } }, currentEmail: { id: "synthetic-email", contact: "abe@example.com", subject: "PLA Basic", direction: "inbound", body: "Please use Black PLA Basic, 500 spools." }, products: [{ sku: "PLA-BASIC", name: "PLA Basic", currency: "USD", priceMinor: 800, moq: 1, variants: [{ id: "black", name: "Black", sku: "PLA-BLACK", priceMinor: 800 }] }], invoiceDefaults: { currency: "USD" } };
      const plan = await generateCrmPlan({ ...models, prompt: JSON.stringify({ CONVERSATION: scenario.messages, SERVER_DATA: serverData }), messages: scenario.messages, pathname: "/companies", language: "en", signal: AbortSignal.timeout(45000), validateAction: () => {}, read: async () => ({ records: [serverData.currentCompany], coverage: { included: 1, nextOffset: null } }), searchEmails: async () => ({ records: [serverData.currentEmail], coverage: { included: 1, nextOffset: null } }) });
      results.push({ model, case: scenario.name, passed: scenario.check(plan.actions), elapsedMs: Math.round(performance.now() - started), actions: plan.actions, question: plan.clarification?.question });
    } catch (error) { results.push({ model, case: scenario.name, passed: false, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : "Unknown evaluation error" }); }
    const latest = results.at(-1)!;
    console.log(JSON.stringify({ model, case: latest.case, passed: latest.passed, elapsedMs: latest.elapsedMs, ...(latest.error ? { error: latest.error } : {}) }));
    mkdirSync("docs/audit-evidence", { recursive: true });
    writeFileSync("docs/audit-evidence/native-agent-models-20261105.json", JSON.stringify({ syntheticOnly: true, maximumQuotedUsd: .10, quotedUsd: reserved / 1e6, chargedUsd: charged / 1e6, results }, null, 2) + "\n");
  }
}
if (results.some(value => !value.passed)) process.exitCode = 1;
