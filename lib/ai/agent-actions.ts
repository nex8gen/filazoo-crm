import { z } from "zod";
import { agentEmailSchema, workspaceActionSchema } from "./workspace-assistant.ts";
import { invoiceDocumentSchema, type InvoiceDocument } from "../invoices.ts";
import { productInvoiceLine, productUnitPrice, type InvoiceProduct } from "../invoice-links.ts";
import type { InvoiceBankAccount } from "../invoice-banks.ts";

export const preparedAgentActionSchema = z.discriminatedUnion("type", [
  workspaceActionSchema.options[0],
  z.object({ type: z.literal("create_invoice"), document: invoiceDocumentSchema, email: agentEmailSchema.optional() }).strict(),
  z.object({ type: z.literal("update_invoice"), invoiceId: z.uuid(), revision: z.number().int().positive(), document: invoiceDocumentSchema, email: agentEmailSchema.optional() }).strict(),
  z.object({ type: z.literal("send_invoice"), invoiceId: z.uuid(), revision: z.number().int().positive(), document: invoiceDocumentSchema, email: agentEmailSchema }).strict(),
]);
export type PreparedAgentAction = z.infer<typeof preparedAgentActionSchema>;
export type AgentProposal = { id: string; action: PreparedAgentAction; approvalMode: "ask" | "auto"; expiresAt: string };
export type AgentActionResult = { success?: string; error?: string; href?: string; status?: string };

/** Catalog prices and bank details are resolved by code, never supplied by the model. */
export function buildAgentInvoice(
  base: InvoiceDocument,
  selection: { items: { productSku: string; variantId?: string; quantity: number }[]; bankAccountId?: string },
  products: InvoiceProduct[],
  banks: InvoiceBankAccount[],
) {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const items = selection.items.map((item) => {
    const product = bySku.get(item.productSku);
    if (!product) throw new Error(`Product ${item.productSku} is unavailable. Choose a current catalog product.`);
    if (product.variants.length && !item.variantId) throw new Error(`Choose a specific variant for ${product.name}.`);
    if (item.variantId && !product.variants.some((variant) => variant.id === item.variantId)) throw new Error(`Choose a current variant for ${product.name}.`);
    if (item.quantity < product.moq) throw new Error(`${product.name} has a minimum quantity of ${product.moq}. Confirm an agreed price in the invoice editor for ${item.quantity} pieces.`);
    if (productUnitPrice(product, item.quantity, item.variantId) === null) throw new Error(`Confirm an agreed unit price for ${product.name} in the invoice editor.`);
    if (product.currency !== base.currency) throw new Error(`${product.name} uses ${product.currency}; the invoice uses ${base.currency}. Confirm the invoice currency first.`);
    const existing = base.items.find((line) => line.productSku === item.productSku && line.variantId === item.variantId);
    return { ...productInvoiceLine(product, item.quantity, item.variantId), taxBps: existing?.taxBps ?? 0 };
  });
  const bank = selection.bankAccountId ? banks.find((account) => account.id === selection.bankAccountId) : undefined;
  if (selection.bankAccountId && !bank) throw new Error("Choose an active saved bank account.");
  return invoiceDocumentSchema.parse({ ...base, items, ...(bank ? { bankAccountId: bank.id, bankAccount: bank } : {}) });
}

export function agentApprovalAllowed(savedMode: "ask" | "auto", approval: "manual" | "auto") {
  return approval === "manual" || savedMode === "auto";
}
