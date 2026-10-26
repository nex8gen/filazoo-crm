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
async function generate(prompt = options.prompt) {
const configured = { ...options, prompt };
if (process.env.GEMINI_API_KEY) {
  try { return await generateGeminiText({ ...configured, apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_AGENT_MODEL || process.env.GEMINI_EMAIL_MODEL }); }
  catch (error) {
    if (!gatewayToken || !isGeminiRegionError(error)) throw error;
    return await generateGatewayText({ ...configured, token: gatewayToken, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
  }
} else if (gatewayToken) return await generateGatewayText({ ...configured, token: gatewayToken, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
else throw new Error("An AI provider is required for this smoke test.");
}
const output = await generate();
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

const sourceEmail = { id: "synthetic-mail-1", direction: "inbound", contact: "buyer@example.com", subject: "Order confirmation", text: "Please invoice 200 black PLA and 23 white PETG. Our PO reference is PO-TEST-42. Ship to 88 Test Road, Shanghai. Please use the saved USD bank.", timestamp: "2026-10-26T00:00:00Z" };
const serverData = {
  currentCompanyId: companyId,
  currentCompany: { id: companyId, fields: { name: "Example Print Studio", contactEmail: "buyer@example.com", "commerce.shippingAddress": "Old test address" } },
  currentEmail: sourceEmail,
  emailHistory: [sourceEmail],
  invoiceDefaults: { currency: "USD", customerName: "Example Print Studio", customerEmail: "buyer@example.com" },
  products: [
    { sku: "TEST-PLA", name: "PLA", currency: "USD", moq: 1, priceMinor: 500, variants: [{ id: "pla-black", name: "Black", sku: "PLA-BLACK", priceMinor: 500 }] },
    { sku: "TEST-PETG", name: "PETG", currency: "USD", moq: 1, priceMinor: 700, variants: [{ id: "petg-white", name: "White", sku: "PETG-WHITE", priceMinor: 700 }] },
  ],
  banks: [{ id: bankId, label: "USD bank", currency: "USD" }], sender: "sales@example.com", permissions: { role: "admin", canAct: true },
};
const emailInput = workspaceAssistantSchema.parse({ mode: "work", pathname: "/emails", pageLabel: "Email", pageText: "Synthetic email", pageContext: { emailId: sourceEmail.id }, messages: [{ role: "user", content: "Create an invoice from this email and prepare a reply in the inbox with its PDF attached. Do not send the email." }] });
const emailOutput = await generate(buildWorkspaceAssistantPrompt(emailInput, serverData));
const emailActions = extractWorkspaceActions(emailOutput).actions;
assert.equal(emailActions.length, 1, emailOutput);
const created = emailActions[0];
assert.equal(created.type, "create_invoice", emailOutput);
if (created.type !== "create_invoice") throw new Error("Expected email-based invoice creation.");
assert.equal(created.companyId, companyId);
assert.equal(created.sourceEmailId, sourceEmail.id);
assert.deepEqual(created.items, action.items);
assert.equal(created.email?.delivery, "draft");
assert.equal(created.email?.sourceEmailId, sourceEmail.id);
assert.equal(created.email?.to, "buyer@example.com");
assert.equal(created.details?.reference, "PO-TEST-42");
assert.match(created.details?.shippingAddress || "", /88 Test Road/);
console.log("PASS: open-email request uses its customer, exact order, shipping and PO reference, and prepares a threaded invoice email draft.");

const profileInput = workspaceAssistantSchema.parse({ ...emailInput, messages: [{ role: "user", content: 'Update this customer shipping address to "99 New Test Road, Shanghai" and add a customer note "Prefers morning deliveries". Leave every other field unchanged.' }] });
const profileOutput = await generate(buildWorkspaceAssistantPrompt(profileInput, serverData));
const profileActions = extractWorkspaceActions(profileOutput).actions;
const changed = profileActions.find((item) => item.type === "update_company");
const note = profileActions.find((item) => item.type === "add_company_note");
assert.equal(changed?.companyId, companyId, profileOutput);
assert.equal(changed?.changes.commerce?.shippingAddress, "99 New Test Road, Shanghai");
assert.equal(note?.companyId, companyId, profileOutput);
assert.match(note?.note || "", /Prefers morning deliveries/);
assert.equal(profileActions.length, 2, profileOutput);
console.log("PASS: natural-language customer updates produce a field patch and an appended note. No records changed or emails sent.");
