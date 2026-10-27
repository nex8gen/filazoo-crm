import { z } from "zod";
import { agentEmailSchema, workspaceActionSchema, type WorkspaceAction } from "./workspace-assistant.ts";
import { invoiceDocumentSchema, type InvoiceDocument } from "../invoices.ts";
import { productInvoiceLine, productUnitPrice, type InvoiceProduct } from "../invoice-links.ts";
import type { InvoiceBankAccount } from "../invoice-banks.ts";
import type { InvoicePaymentMethod } from "../invoice-payment-methods.ts";

export const preparedAgentEmailSchema = agentEmailSchema.extend({
  threadId: z.string().min(1).max(1100).optional(),
  inReplyTo: z.string().regex(/^<[^<>\s]+>$/).optional(),
  references: z.array(z.string().regex(/^<[^<>\s]+>$/)).max(100).optional(),
}).strict();
export const preparedAgentActionSchema = z.discriminatedUnion("type", [
  workspaceActionSchema.options[0],
  z.object({ type: z.literal("create_invoice"), document: invoiceDocumentSchema, email: preparedAgentEmailSchema.optional() }).strict(),
  z.object({ type: z.literal("update_invoice"), invoiceId: z.uuid(), revision: z.number().int().positive(), document: invoiceDocumentSchema, email: preparedAgentEmailSchema.optional() }).strict(),
  z.object({ type: z.literal("send_invoice"), invoiceId: z.uuid(), revision: z.number().int().positive(), document: invoiceDocumentSchema, email: preparedAgentEmailSchema }).strict(),
  workspaceActionSchema.options[4].extend({ companyName: z.string(), fingerprint: z.string().length(64) }).strict(),
  workspaceActionSchema.options[5].extend({ companyName: z.string() }).strict(),
  z.object({ type: z.literal("write_email"), email: preparedAgentEmailSchema }).strict(),
  workspaceActionSchema.options[7],
]);
export type PreparedAgentAction = z.infer<typeof preparedAgentActionSchema>;
export type AgentProposal = { id: string; action: PreparedAgentAction; approvalMode: "ask" | "auto"; expiresAt: string };
export type AgentActionResult = { success?: string; error?: string; href?: string; status?: string };

type AgentInvoiceSelection = Pick<Extract<WorkspaceAction, { type: "update_invoice" }>, "items" | "bankAccountId" | "paymentMethodIds" | "details">;

/** Catalog prices and current payment snapshots are resolved by code, never supplied by the model. */
export function buildAgentInvoice(
  base: InvoiceDocument,
  selection: AgentInvoiceSelection,
  products: InvoiceProduct[],
  banks: InvoiceBankAccount[],
  paymentMethods: InvoicePaymentMethod[] = [],
  options: { creating?: boolean } = {},
) {
  const currency = selection.details?.currency ?? base.currency;
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const items = selection.items?.map((item) => {
    const product = bySku.get(item.productSku);
    if (!product) throw new Error(`Product ${item.productSku} is unavailable. Choose a current catalog product.`);
    if (product.variants.length && !item.variantId) throw new Error(`Choose a specific variant for ${product.name}.`);
    if (item.variantId && !product.variants.some((variant) => variant.id === item.variantId)) throw new Error(`Choose a current variant for ${product.name}.`);
    if (item.quantity < product.moq) throw new Error(`${product.name} has a minimum quantity of ${product.moq}. Confirm an agreed price in the invoice editor for ${item.quantity} pieces.`);
    if (productUnitPrice(product, item.quantity, item.variantId) === null) throw new Error(`Confirm an agreed unit price for ${product.name} in the invoice editor.`);
    if (product.currency !== currency) throw new Error(`${product.name} uses ${product.currency}; the invoice uses ${currency}. Confirm the invoice currency first.`);
    const existing = base.items.find((line) => line.productSku === item.productSku && line.variantId === item.variantId);
    return { ...productInvoiceLine(product, item.quantity, item.variantId), taxBps: item.taxBps ?? existing?.taxBps ?? 0 };
  }) ?? base.items;
  if (selection.bankAccountId && selection.paymentMethodIds !== undefined) throw new Error("Choose current payment methods or a legacy bank account, not both.");
  const bank = selection.bankAccountId ? banks.find((account) => account.id === selection.bankAccountId) : undefined;
  if (selection.bankAccountId && !bank) throw new Error("Choose an active saved bank account.");
  let payment: Partial<InvoiceDocument> = {};
  if (selection.paymentMethodIds !== undefined || (options.creating && !bank)) {
    const selected = selection.paymentMethodIds?.map((id) => {
      const method = paymentMethods.find((value) => value.id === id);
      if (!method) throw new Error("Choose a current saved payment method.");
      return method;
    }) ?? paymentMethods.filter((method) => !method.currency || method.currency === currency);
    if (options.creating && selection.paymentMethodIds === undefined && paymentMethods.length && !selected.length) throw new Error(`No current payment methods support ${currency}. Add one in invoice payment settings.`);
    payment = { paymentMethods: selected, bankAccountId: undefined, bankAccount: undefined, paymentInstructions: "" };
  } else if (bank) payment = { bankAccountId: bank.id, bankAccount: bank, paymentMethods: [], paymentInstructions: "" };
  return invoiceDocumentSchema.parse({ ...base, ...selection.details, items, ...payment });
}

export function agentApprovalAllowed(savedMode: "ask" | "auto", approval: "manual" | "auto") {
  return approval === "manual" || savedMode === "auto";
}
