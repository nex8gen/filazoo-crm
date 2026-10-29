import { z } from "zod";
import { agentEmailSchema, workspaceActionSchema, type WorkspaceAction } from "./workspace-assistant.ts";
import { invoiceDocumentSchema, type InvoiceDocument } from "../invoices.ts";
import { productInvoiceLine, productUnitPrice, type InvoiceProduct } from "../invoice-links.ts";
import type { InvoiceBankAccount } from "../invoice-banks.ts";
import type { InvoicePaymentMethod } from "../invoice-payment-methods.ts";
import { preparedCrmActionSchema } from "./crm-tools.ts";

export const preparedAgentEmailSchema = agentEmailSchema.extend({
  catalogSnapshot: z.object({
    productSkus: z.array(z.string().min(1).max(200)).min(1).max(499),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
  mailboxId: z.uuid().optional(),
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
  preparedCrmActionSchema,
]);
export type PreparedAgentAction = z.infer<typeof preparedAgentActionSchema>;
export type AgentProposal = { id: string; action: PreparedAgentAction; approvalMode: "ask" | "auto"; expiresAt: string };
export type AgentActionResult = { success?: string; error?: string; href?: string; status?: string; approval?: string; finishedAt?: string; draftMessage?: { conversationId: string; text: string } };

type AgentInvoiceSelection = Pick<Extract<WorkspaceAction, { type: "update_invoice" }>, "items" | "bankAccountId" | "paymentMethodIds" | "details">;

export class AgentClarificationError extends Error { name = "AgentClarificationError"; }
export type AgentPlanningContext = { messages: readonly { role: string; content: string }[] };

/** An invoice request cannot authorize an extra email invented by the provider. */
export function groundInvoiceEmailIntent(action: WorkspaceAction, context?: AgentPlanningContext): WorkspaceAction {
  if (!context || (action.type !== "create_invoice" && action.type !== "update_invoice" && action.type !== "send_invoice") || !action.email) return action;
  let intent: "draft" | "send" | null = null;
  for (const message of [...context.messages].reverse()) {
    if (message.role !== "user") continue;
    const text = message.content;
    if (/\b(?:don['’]?t|do not|never|not yet)\s+(?:send|email|mail)\b|\b(?:draft|review)\s+only\b|\bfor review only\b|\bonly\s+(?:a\s+)?draft\b|不要发送|仅供审核|(?:只|仅).*草稿/i.test(text)
      || /\b(?:when|once|after|if|until)\b.{0,100}\b(?:repl(?:y|ies)|respond|confirm|approv|address)/i.test(text)) break;
    if (/\b(?:draft|write|prepare)\b.{0,35}\b(?:email|message|reply)\b|(?:草拟|起草|准备).*邮件/i.test(text)) { intent = "draft"; break; }
    if (!/^(?:did|have|has)\s+you\b/i.test(text.trim()) && /\b(?:send|email|mail)\s+(?:(?:the|this|that|an?|it|them|invoice|to|customer)\b)|发送.*(?:发票|邮件)|把.*发票.*发/i.test(text)) { intent = "send"; break; }
    if (/\b(?:create|make|prepare|draft|update|change|edit)\b.{0,40}\b(?:invoice|invioce|inovice)\b|(?:创建|准备|更新|修改).*发票/i.test(text)) break;
  }
  if (!intent) {
    if (action.type === "send_invoice") throw new AgentClarificationError("Should I prepare an email draft or send this invoice? Please specify the email action.");
    const { email: _email, ...invoice } = action;
    void _email;
    return invoice;
  }
  return { ...action, email: { ...action.email, delivery: intent } };
}

/** Resolve an explicit single-line SKU/color against the catalog, never a nearby color. */
export function groundInvoiceVariant(selection: AgentInvoiceSelection, products: InvoiceProduct[], context?: AgentPlanningContext) {
  if (!context || selection.items?.length !== 1) return selection;
  const item = selection.items[0], product = products.find((product) => product.sku === item.productSku);
  if (!product?.variants.length) return selection;
  const colors = (text: string) => [...new Set((text.toLowerCase().match(/\b(?:black|white|red|gold|silver|blue|green|yellow|orange|purple|pink|grey|gray|brown|beige|clear|transparent|natural|rainbow|copper|bronze)\b/g) ?? []).map((color) => color === "grey" ? "gray" : color === "transparent" ? "clear" : color))].sort();
  for (const message of [...context.messages].reverse()) {
    if (message.role !== "user" || /^(?:did|do|does|have|has)\s+(?:you|it)\b/i.test(message.content.trim())) continue;
    const exact = product.variants.filter((variant) => variant.sku && new RegExp(`(?:^|[^a-z0-9_-])${variant.sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_-])`, "i").test(message.content));
    if (exact.length === 1) return { ...selection, items: [{ ...item, variantId: exact[0].id }] };
    const requested = colors(message.content);
    if (!requested.length || !/\b(?:pla|petg|abs|asa|tpu|silk|filament|product|color|colour|pcs?|pieces?|pas|instead|change|make|use|only|want)\b/i.test(message.content)) continue;
    const matches = product.variants.filter((variant) => JSON.stringify(colors(variant.name)) === JSON.stringify(requested));
    if (matches.length === 1) return { ...selection, items: [{ ...item, variantId: matches[0].id }] };
    throw new AgentClarificationError(`Which saved variant of ${product.name} should I use? I could not uniquely match ${requested.join(" / ")}. Available choices: ${product.variants.slice(0, 12).map((variant) => variant.name).join(", ")}${product.variants.length > 12 ? " (more variants are available)" : ""}.`);
  }
  return selection;
}

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
    if (product.variants.length && !item.variantId) throw new AgentClarificationError(`Choose a specific variant for ${product.name}. Which color or variant should I use: ${product.variants.slice(0, 12).map((variant) => variant.name).join(", ")}?`);
    if (item.variantId && !product.variants.some((variant) => variant.id === item.variantId)) throw new AgentClarificationError(`Choose a current variant for ${product.name}. Which saved color or variant should I use?`);
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
