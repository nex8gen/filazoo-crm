import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentInvoice, agentApprovalAllowed } from "../lib/ai/agent-actions.ts";
import { workspaceActionSchema, workspaceAssistantSchema, extractWorkspaceActions } from "../lib/ai/workspace-assistant.ts";
import { blankInvoiceDocument, invoiceTotals } from "../lib/invoices.ts";
import type { InvoiceProduct } from "../lib/invoice-links.ts";
import type { InvoiceBankAccount } from "../lib/invoice-banks.ts";
import { assistantProviderError } from "../lib/ai/assistant-provider-error.ts";

const companyId = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
const bank: InvoiceBankAccount = { id: "c8658f23-965c-49b3-a11a-35dc61920fc6", label: "USD bank", currency: "USD", beneficiaryName: "Filazoo", beneficiaryAddress: "", accountNumber: "123456", bankName: "Test Bank", bankAddress: "", swift: "TESTUS33", bankCode: "" };
const product = (sku: string, name: string, color: string, price: number): InvoiceProduct => ({ sku, name, currency: "USD", moq: 1, priceMinor: price, imageUrl: null, stockStatus: "Available", tiers: [], variants: [{ id: `${sku}-color`, name: color, sku: `${sku}-01`, priceMinor: price, stockStatus: "Available", imageUrl: null }] });
const pla = product("PLA", "PLA", "Black", 500);
const petg = product("PETG", "PETG", "White", 700);
const selection = { items: [{ productSku: "PLA", variantId: "PLA-color", quantity: 200 }, { productSku: "PETG", variantId: "PETG-color", quantity: 23 }], bankAccountId: bank.id };
const base = { ...blankInvoiceDocument("2026-10-26"), customerName: "Acme", companyId };

test("builds exactly 200 black PLA and 23 white PETG with real prices and saved bank details", () => {
  const document = buildAgentInvoice(base, selection, [pla, petg], [bank]);
  assert.deepEqual(document.items.map((item) => [item.productSku, item.variantId, item.quantity, item.unitPriceMinor]), [["PLA", "PLA-color", 200, 500], ["PETG", "PETG-color", 23, 700]]);
  assert.equal(document.bankAccount?.accountNumber, bank.accountNumber);
  assert.equal(document.bankAccountId, bank.id);
  assert.equal(invoiceTotals(document).total, 116100);
});

test("uses catalog tiers without accepting invented prices from the model", () => {
  const document = buildAgentInvoice(base, selection, [{ ...pla, tiers: [{ minimumQuantity: 100, priceMinor: 450 }] }, petg], [bank]);
  assert.equal(document.items[0].unitPriceMinor, 450);
  assert.equal(workspaceActionSchema.safeParse({ type: "create_invoice", companyId, ...selection, items: [{ ...selection.items[0], unitPriceMinor: 1 }] }).success, false);
});

test("preserves the saved tax rate when updating an existing catalog line", () => {
  const initial = buildAgentInvoice(base, selection, [pla, petg], [bank]);
  initial.items[0].taxBps = 750;
  assert.equal(buildAgentInvoice(initial, selection, [pla, petg], [bank]).items[0].taxBps, 750);
});

test("provider errors explain missing billing, expired credentials, and regional availability", () => {
  assert.match(assistantProviderError(new Error("AI Gateway requires a valid credit card on file")), /billing is not enabled/);
  assert.match(assistantProviderError(new Error("Authentication failed")), /refresh the Vercel/);
  assert.match(assistantProviderError(new Error("User location is not supported")), /supported region/);
  assert.ok(!assistantProviderError(new Error("unknown request private-token-value")).includes("private-token-value"));
});

test("does not silently substitute variants, currencies, missing prices, banks, or minimum quantities", () => {
  assert.throws(() => buildAgentInvoice(base, { ...selection, items: [{ ...selection.items[0], variantId: undefined }] }, [pla], [bank]), /specific variant/);
  assert.throws(() => buildAgentInvoice(base, selection, [{ ...pla, currency: "EUR" }, petg], [bank]), /EUR/);
  assert.throws(() => buildAgentInvoice(base, selection, [{ ...pla, moq: 300 }, petg], [bank]), /200 pieces/);
  assert.throws(() => buildAgentInvoice(base, selection, [{ ...pla, priceMinor: null, variants: [{ ...pla.variants[0], priceMinor: null }] }, petg], [bank]), /agreed unit price/);
  assert.throws(() => buildAgentInvoice(base, selection, [pla, petg], []), /active saved bank/);
  assert.throws(() => buildAgentInvoice(base, selection, [pla, petg], [{ ...bank, currency: "EUR" }]), /currency/);
});

test("requires an explicit choice for auto approval and blocks auto execution of manual proposals", () => {
  const request = workspaceAssistantSchema.parse({ mode: "work", pathname: "/invoices", pageLabel: "Invoices", pageText: "", messages: [{ role: "user", content: "Create an invoice" }] });
  assert.equal(request.approvalMode, "ask");
  assert.equal(agentApprovalAllowed("ask", "auto"), false);
  assert.equal(agentApprovalAllowed("ask", "manual"), true);
  assert.equal(agentApprovalAllowed("auto", "auto"), true);
});

test("supports one create-and-email task and rejects forged attachment content and bad recipients", () => {
  const action = { type: "create_invoice", companyId, ...selection, email: { to: "buyer@example.com", subject: "Your invoice", text: "Please find your invoice attached." } };
  assert.equal(workspaceActionSchema.safeParse(action).success, true);
  assert.equal(workspaceActionSchema.safeParse({ ...action, email: { ...action.email, attachments: [{ content: "forged" }] } }).success, false);
  assert.equal(workspaceActionSchema.safeParse({ ...action, email: { ...action.email, to: "bad-address" } }).success, false);
  assert.equal(workspaceActionSchema.safeParse({ ...action, email: { ...action.email, subject: "Invoice\r\nBcc: other@example.com" } }).success, false);
  assert.equal(extractWorkspaceActions(`Ready.\nFILAZOO_ACTIONS_JSON: ${JSON.stringify([action])}`).actions[0]?.type, "create_invoice");
});
