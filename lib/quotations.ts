import { z } from "zod";
import { invoiceCurrencies } from "./invoices.ts";
import { quotedMinor, productUnitPrice, type InvoiceProduct } from "./invoice-links.ts";
import type { Product } from "./types.ts";
import type { PurchaseOrderDocument } from "./purchase-orders.ts";

const money = z.number().int().min(0).max(100_000_000);
export const quotationStatuses = ["draft", "shared", "accepted", "declined", "cancelled", "superseded"] as const;
export type QuotationStatus = typeof quotationStatuses[number];
export const quotationStatusLabels: Record<QuotationStatus | "expired" | "converted", string> = { draft: "Draft", shared: "Shared", accepted: "Accepted", declined: "Declined", cancelled: "Cancelled", superseded: "Superseded", expired: "Expired", converted: "Order created" };
export const quotationLineInputSchema = z.object({ productSku: z.string().trim().min(1).max(200), variantId: z.string().max(200).optional(), quantity: z.number().int().min(1).max(1_000_000), pricingMode: z.enum(["saved", "agreed"]), unitPriceMinor: money.optional() }).strict();
export const quotationInputSchema = z.object({
  validUntil: z.iso.date(), customerEmail: z.union([z.email(), z.literal("")]), billingAddress: z.string().trim().max(2000), taxId: z.string().trim().max(100),
  shippingAddress: z.string().trim().max(2000), shippingRecipient: z.string().trim().max(160), shippingPhone: z.string().trim().max(80),
  shippingMinor: money, shippingConfirmed: z.boolean(), preShipmentPercent: z.number().int().min(0).max(100),
  paymentTerms: z.string().trim().max(2000), notes: z.string().trim().max(2000), items: z.array(quotationLineInputSchema).min(1).max(99),
}).strict();
export type QuotationInput = z.infer<typeof quotationInputSchema>;
const savedLineSchema = quotationLineInputSchema.extend({ description: z.string().min(1).max(500), sku: z.string().max(200), variantSku: z.string().max(200).optional(), unitPriceMinor: money }).strict();
export const quotationDocumentSchema = quotationInputSchema.extend({
  sellerName: z.string().min(1).max(200), sellerAddress: z.string().max(2000), customerName: z.string().min(1).max(200),
  issueDate: z.iso.date(), currency: z.enum(invoiceCurrencies), subtotalMinor: z.number().int().min(0).max(1_000_000_000_000), totalMinor: z.number().int().min(0).max(1_000_000_000_000),
  items: z.array(savedLineSchema).min(1).max(99),
}).superRefine((doc, ctx) => {
  const subtotal = doc.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
  if (subtotal !== doc.subtotalMinor || subtotal + doc.shippingMinor !== doc.totalMinor) ctx.addIssue({ code: "custom", message: "Quotation totals do not match the saved items and shipping." });
  if (doc.validUntil < doc.issueDate) ctx.addIssue({ code: "custom", message: "The validity date must be on or after the issue date." });
});
export type QuotationDocument = z.infer<typeof quotationDocumentSchema>;
export type QuotationRecord = {
  id: string; company_id: string; company: string; currency: string; version: number; product_skus: string[]; product_snapshot: Product[] | null;
  quote_document: QuotationDocument | null; quote_status: QuotationStatus; quote_revision: number; quote_order_id: string | null; quote_previous_id: string | null;
};
export type QuotationDetail = { catalog: QuotationRecord; initial: QuotationInput; canWrite: boolean };
export const quotationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), revision: z.number().int().min(0), document: quotationInputSchema }).strict(),
  z.object({ action: z.enum(["share", "decline", "cancel", "revise"]), revision: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal("accept"), revision: z.number().int().min(0), note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("convert"), revision: z.number().int().min(0), allowCustomItems: z.boolean().default(false) }).strict(),
]);
export type QuotationAction = z.infer<typeof quotationActionSchema>;
export function quotationToday(now = new Date()) { return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10); }
export function quotationLabel(catalog: Pick<QuotationRecord, "id" | "version">) { return `Q-${catalog.id.replaceAll("-", "").slice(0, 8).toUpperCase()}-V${catalog.version}`; }
export function quotationState(catalog: Pick<QuotationRecord, "quote_status" | "quote_document" | "quote_order_id">, today = quotationToday()): QuotationStatus | "expired" | "converted" {
  if (catalog.quote_order_id) return "converted";
  return catalog.quote_status === "shared" && catalog.quote_document && catalog.quote_document.validUntil < today ? "expired" : catalog.quote_status;
}
export function quotationProduct(product: Product, currency: string): InvoiceProduct {
  return { sku: product.sku, name: product.name, imageUrl: product.imageUrl, currency, priceMinor: quotedMinor(product.price), moq: Math.max(1, product.moq ?? 1), stockStatus: product.stockStatus,
    tiers: product.priceTiers.flatMap(tier => { const value = quotedMinor(tier.price); return value === null ? [] : [{ minimumQuantity: tier.minimumQuantity, priceMinor: value }]; }).sort((a, b) => a.minimumQuantity - b.minimumQuantity),
    variants: product.variants.map(variant => ({ ...variant, priceMinor: quotedMinor(variant.price) })),
  };
}
export function buildQuotation(input: QuotationInput, products: Product[], base: Pick<QuotationDocument, "sellerName" | "sellerAddress" | "customerName" | "issueDate" | "currency">): QuotationDocument {
  const parsed = quotationInputSchema.parse(input);
  const bySku = new Map(products.map(product => [product.sku, product]));
  const items = parsed.items.map(line => {
    const saved = bySku.get(line.productSku);
    if (!saved || (saved.currency && saved.currency !== base.currency)) throw new Error("Choose products from this quotation's saved selection and currency.");
    const product = quotationProduct(saved, base.currency);
    const variant = line.variantId ? product.variants.find(item => item.id === line.variantId) : undefined;
    if ((line.variantId && !variant) || (!line.variantId && product.variants.length > 1)) throw new Error(`Choose a saved variant for ${product.name}.`);
    if (line.pricingMode === "saved" && line.quantity < product.moq) throw new Error(`Use an agreed price for quantities below the saved minimum for ${product.name}.`);
    const price = line.pricingMode === "agreed" ? line.unitPriceMinor : productUnitPrice(product, line.quantity, line.variantId);
    if (price === null || price === undefined) throw new Error(`Enter an agreed unit price for ${product.name}.`);
    return { ...line, ...(variant ? { variantSku: variant.sku } : {}), sku: variant?.sku || product.sku, description: `${product.name}${variant ? ` - ${variant.name}` : ""}`.slice(0, 500), unitPriceMinor: price };
  });
  const subtotalMinor = items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
  return quotationDocumentSchema.parse({ ...base, ...parsed, items, subtotalMinor, totalMinor: subtotalMinor + parsed.shippingMinor });
}
export function quotationShareBlockers(doc: QuotationDocument | null, today = quotationToday()) {
  if (!doc) return ["Save the quotation details first."];
  return [doc.validUntil < today ? "Set a validity date that has not expired." : "", !doc.shippingConfirmed ? "Confirm the shipping cost, including agreed free shipping." : "", !doc.paymentTerms.trim() ? "Enter the agreed payment terms." : ""].filter(Boolean);
}
export function quotationOrder(doc: QuotationDocument, reference: string, canLink: (line: QuotationDocument["items"][number]) => boolean, allowCustomItems: boolean): PurchaseOrderDocument {
  const items = doc.items.map(line => {
    if (!canLink(line)) {
      if (!allowCustomItems) throw new Error("Some saved products cannot be linked to the current catalog. Allow custom order items or revise the quotation.");
      return { description: `${line.description} [SKU: ${line.sku}]`.slice(0, 500), sku: line.sku, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor };
    }
    return { productSku: line.productSku, ...(line.variantId ? { variantId: line.variantId, variantSku: line.variantSku } : {}), sku: line.sku, description: line.description, quantity: line.quantity, unitPriceMinor: line.unitPriceMinor, pricingMode: "manual" as const };
  });
  // Freight is a reservable order line, so split invoices cannot charge it twice.
  if (doc.shippingMinor > 0) items.push({ description: "Shipping", sku: "FREIGHT", quantity: 1, unitPriceMinor: doc.shippingMinor });
  return { reference, orderDate: quotationToday(), deliveryDate: "", currency: doc.currency, status: "draft", paymentPolicy: "custom", preShipmentPercent: doc.preShipmentPercent, paymentTerms: doc.paymentTerms,
    customer: { companyName: doc.customerName, contactName: "", contactRole: "", contactEmail: doc.customerEmail, billingEmail: doc.customerEmail, billingAddress: doc.billingAddress, taxId: doc.taxId, phone: doc.shippingPhone },
    shippingAddress: doc.shippingAddress, shippingRecipient: doc.shippingRecipient, shippingPhone: doc.shippingPhone,
    notes: [`From quotation ${reference}.`, doc.notes].filter(Boolean).join("\n\n"), items };
}
