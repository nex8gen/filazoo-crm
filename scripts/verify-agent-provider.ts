// Read-only provider smoke test using synthetic CRM data. Never saves or sends.
// node --env-file=.env.local --experimental-strip-types scripts/verify-agent-provider.ts
import assert from "node:assert/strict";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../lib/ai/gateway.ts";
import { workspaceAssistantSchema, workspaceAssistantInstruction, buildWorkspaceAssistantPrompt, extractWorkspaceActions } from "../lib/ai/workspace-assistant.ts";

const companyId = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
const bankId = "c8658f23-965c-49b3-a11a-35dc61920fc6";
const input = workspaceAssistantSchema.parse({ mode: "work", pathname: `/companies/${companyId}`, pageLabel: "Company profile", pageText: "Synthetic test company: Example Print Studio", messages: [{ role: "user", content: "Create an invoice for this company: black PLA 200 pieces and white PETG 23 pieces. Add the saved USD bank payment option. Do not send an email." }] });
const options = {
  systemInstruction: workspaceAssistantInstruction("work", new Date().toISOString()),
  prompt: buildWorkspaceAssistantPrompt(input, {
    currentCompanyId: companyId,
    billing: { customer: { id: companyId, name: "Example Print Studio" } },
    invoiceDefaults: { currency: "USD" },
    products: [
      { sku: "TEST-PLA", name: "PLA", currency: "USD", moq: 1, priceMinor: 500, variants: [{ id: "pla-black", name: "Black", sku: "PLA-BLACK", priceMinor: 500 }] },
      { sku: "TEST-PETG", name: "PETG", currency: "USD", moq: 1, priceMinor: 700, variants: [{ id: "petg-white", name: "White", sku: "PETG-WHITE", priceMinor: 700 }] },
    ],
    banks: [{ id: bankId, label: "USD bank", currency: "USD", bankName: "Synthetic bank" }],
    permissions: { role: "admin", canAct: true },
  }),
  maxOutputTokens: 5000,
  fetcher: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(45000) })) as typeof fetch,
};
const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
let output: string;
if (process.env.GEMINI_API_KEY) {
  try { output = await generateGeminiText({ ...options, apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_AGENT_MODEL || process.env.GEMINI_EMAIL_MODEL }); }
  catch (error) {
    if (!gatewayToken || !isGeminiRegionError(error)) throw error;
    output = await generateGatewayText({ ...options, token: gatewayToken, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
  }
} else if (gatewayToken) output = await generateGatewayText({ ...options, token: gatewayToken, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
else throw new Error("An AI provider is required for this smoke test.");
const { actions } = extractWorkspaceActions(output);
assert.equal(actions.length, 1, output);
const action = actions[0];
assert.equal(action.type, "create_invoice", output);
if (action.type !== "create_invoice") throw new Error("Expected an invoice creation proposal.");
assert.equal(action.companyId, companyId);
assert.equal(action.bankAccountId, bankId);
assert.deepEqual(action.items, [{ productSku: "TEST-PLA", variantId: "pla-black", quantity: 200 }, { productSku: "TEST-PETG", variantId: "petg-white", quantity: 23 }]);
assert.equal(action.email, undefined);
console.log("PASS: agent provider selected the correct company, exact products, colors, quantities and bank. No invoice created or email sent.");
