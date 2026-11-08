import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { buildAgentInvoice, groundInvoiceVariant } from "../lib/ai/agent-actions.ts";
import { agentOrderFromInvoice } from "../lib/ai/order-actions.ts";
import { blankInvoiceDocument } from "../lib/invoices.ts";
import type { InvoiceProduct } from "../lib/invoice-links.ts";

// Synthetic identities only. This runs model planning and real pure business
// validation; it has no database, SMTP, execution or mutation dependencies.
const companyId = "15693adc-0bdf-4617-b214-71b1861764a9";
const request = "can you create order for buyer@example.com with pla basic 100 qty black color and also send the draft invoice email with a nice written email attuch the pdf of the invoice to that email";
const product: InvoiceProduct = { sku: "PLA-BASIC", name: "PLA Basic", imageUrl: null, currency: "USD", priceMinor: 500, moq: 1, stockStatus: "In stock", tiers: [],
  variants: [{ id: "black", name: "Black", sku: "PLA-BLACK", priceMinor: 500, stockStatus: "In stock", imageUrl: null }, { id: "white", name: "White", sku: "PLA-WHITE", priceMinor: 500, stockStatus: "In stock", imageUrl: null }] };
if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ case: "order-invoice-email", syntheticOnly: true, businessWrites: false, maxProviderCalls: 6 }));
  process.exit(0);
}
let calls = 0;
const fetcher: typeof fetch = async (url, init) => {
  if (++calls > 6) throw new Error("Verification provider call limit reached.");
  return fetch(url, init);
};
const messages = [{ role: "user", content: request }];
const customer = { id: companyId, name: "Synthetic Printing", fields: { name: "Synthetic Printing", contactEmail: "buyer@example.com" } };
const data = { currentCompanyId: companyId, currentCompany: customer, products: [product], invoiceDefaults: { currency: "USD" }, paymentMethods: [], mailbox: { connected: true, canSend: true } };
const base = { ...blankInvoiceDocument("2026-11-07"), companyId, customerName: "Synthetic Printing", customerEmail: "buyer@example.com" };
const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
const gatewayModels = () => nativeGatewayModels({ token: token!, userId: companyId, userText: request, fetcher });
const models = token ? await gatewayModels() : undefined;
if (!models) throw new Error("No configured provider is available.");
const provider = "vercel-ai-gateway";
const run = (selected: typeof models) => generateCrmPlan({ ...selected!, prompt: JSON.stringify({ CONVERSATION: messages, SERVER_DATA: data }), messages, pathname: "/email", language: "en", signal: AbortSignal.timeout(60_000),
  read: async input => ({ records: input.resource === "products" ? [product] : [customer], coverage: { included: 1, nextOffset: null } }), searchEmails: async () => ({ records: [], coverage: { included: 0, nextOffset: null } }),
  validateAction: action => {
    if (action.type !== "create_order" && action.type !== "create_invoice") throw new Error("Use one create_order workflow with the requested invoice email; future record IDs do not exist yet.");
    assert.equal(action.companyId, companyId);
    agentOrderFromInvoice(buildAgentInvoice(base, groundInvoiceVariant(action, [product], { messages }), [product], [], [], { creating: true }));
  },
});
try {
  const plan = await run(models);
  assert.equal(plan.actions.length, 1);
  const action = plan.actions[0];
  assert.ok(action.type === "create_order" || action.type === "create_invoice");
  assert.deepEqual(action.items, [{ productSku: product.sku, variantId: "black", quantity: 100 }]);
  assert.equal(action.email?.to, "buyer@example.com"); assert.equal(action.email?.delivery, "send");
  const evidence = { passed: true, syntheticOnly: true, businessWrites: false, provider, providerCalls: calls, contractVersion: plan.contractVersion, action };
  mkdirSync("docs/audit-evidence", { recursive: true });
  writeFileSync("docs/audit-evidence/order-agent-workflow-20261107.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, provider, providerCalls: calls, action: action.type }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, provider, providerCalls: calls, error: error instanceof Error ? error.message.slice(0, 250) : "Verification failed" }));
  process.exitCode = 1;
}
