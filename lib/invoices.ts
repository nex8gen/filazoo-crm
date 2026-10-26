import { z } from "zod";
import { invoiceBankAccountSchema } from "./invoice-banks.ts";
import { invoicePaymentMethodsSchema } from "./invoice-payment-methods.ts";

// All supported currencies use two decimal places. Store money as integer minor units.
export const invoiceCurrencies = [
  "USD",
  "EUR",
  "GBP",
  "CNY",
  "CAD",
  "AUD",
  "HKD",
] as const;
const money = z.number().int().min(0).max(100_000_000);
const date = z.iso.date();
export const invoiceDocumentSchema = z
  .object({
    sellerName: z.string().trim().min(1).max(200),
    sellerAddress: z.string().trim().max(2000),
    sellerTaxId: z.string().trim().max(100),
    customerName: z.string().trim().min(1).max(200),
    customerEmail: z.union([z.email(), z.literal("")]),
    customerAddress: z.string().trim().max(2000),
    customerTaxId: z.string().trim().max(100),
    companyId: z.uuid().optional(),
    purchaseOrderId: z.uuid().optional(),
    shippingAddress: z.string().trim().max(2000).optional(),
    shippingRecipient: z.string().trim().max(160).optional(),
    shippingPhone: z.string().trim().max(80).optional(),
    contactId: z.uuid().optional(),
    sourceThreadId: z.string().trim().max(1000).optional(),
    currency: z.enum(invoiceCurrencies),
    issueDate: date,
    dueDate: date,
    reference: z.string().trim().max(200),
    notes: z.string().trim().max(4000),
    paymentInstructions: z.string().trim().max(2000),
    paymentMethods: invoicePaymentMethodsSchema.optional(),
    bankAccountId: z.uuid().optional(),
    bankAccount: invoiceBankAccountSchema.optional(),
    discountMinor: money,
    shippingMinor: money,
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          quantity: z.number().int().min(1).max(1_000_000),
          unitPriceMinor: money,
          taxBps: z.number().int().min(0).max(10000),
          productSku: z.string().trim().min(1).max(200).optional(),
          purchaseOrderLineId: z.string().trim().min(1).max(100).optional(),
          imageUrl: z
            .string()
            .max(1000)
            .refine(
              (value) =>
                z.url().safeParse(value).success ||
                /^\/[A-Za-z0-9/_-]+\.[A-Za-z0-9]+$/.test(value),
              "Invalid product image URL",
            )
            .optional(),
          variantId: z.string().trim().min(1).max(200).optional(),
          variantSku: z.string().trim().max(200).optional(),
          pricingMode: z.enum(["catalog", "manual"]).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((doc, ctx) => {
    if (doc.paymentMethods?.some((method) => method.currency && method.currency !== doc.currency))
      ctx.addIssue({ code: "custom", message: "Choose payment methods that match the invoice currency.", path: ["paymentMethods"] });
    if (doc.purchaseOrderId && !doc.companyId) ctx.addIssue({ code: "custom", message: "An order invoice must have a customer.", path: ["companyId"] });
    if (doc.items.some((item) => item.purchaseOrderLineId) && !doc.purchaseOrderId) ctx.addIssue({ code: "custom", message: "Order lines require a linked order.", path: ["purchaseOrderId"] });
    if (doc.bankAccount && doc.bankAccount.id !== doc.bankAccountId)
      ctx.addIssue({ code: "custom", message: "Select a saved bank account.", path: ["bankAccountId"] });
    if (doc.bankAccount?.currency && doc.bankAccount.currency !== doc.currency)
      ctx.addIssue({ code: "custom", message: "Choose a bank account that matches the invoice currency.", path: ["bankAccountId"] });
    if (doc.contactId && !doc.companyId)
      ctx.addIssue({
        code: "custom",
        message: "Select the contact’s company.",
        path: ["contactId"],
      });
    for (const item of doc.items)
      if (
        (item.variantId || item.pricingMode === "catalog") &&
        !item.productSku
      )
        ctx.addIssue({
          code: "custom",
          message: "Select a product for each linked line item.",
          path: ["items"],
        });
    if (doc.dueDate < doc.issueDate)
      ctx.addIssue({
        code: "custom",
        message: "Due date must be on or after the issue date.",
        path: ["dueDate"],
      });
    const subtotal = doc.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceMinor,
      0,
    );
    if (doc.discountMinor > subtotal)
      ctx.addIssue({
        code: "custom",
        message: "Discount cannot exceed the subtotal.",
        path: ["discountMinor"],
      });
    if (subtotal > 100_000_000_000)
      ctx.addIssue({
        code: "custom",
        message: "Invoice exceeds the supported maximum.",
      });
    else if (invoiceTotals(doc).total > 200_000_000_000)
      ctx.addIssue({
        code: "custom",
        message: "Invoice total exceeds the supported maximum.",
      });
  });

export type InvoiceDocument = z.infer<typeof invoiceDocumentSchema>;
export type InvoicePayment = {
  id: string;
  amount_minor: number;
  paid_on: string;
  method: string;
  reference: string;
  created_at: string;
};
export type InvoiceReceivable = {
  currency: string;
  issued_minor: number;
  paid_minor: number;
  outstanding_minor: number;
  overdue_minor: number;
};
export type Invoice = {
  customer_portal_url?: string;
  id: string;
  number: number;
  document: InvoiceDocument;
  status: "draft" | "issued" | "void";
  total_minor: number;
  paid_minor: number;
  revision: number;
  creator_name?: string | null;
  created_by?: string | null;
  creator_avatar_url?: string;
  created_at: string;
  updated_at: string;
  invoice_payments?: InvoicePayment[];
  company_id?: string | null;
  contact_id?: string | null;
  source_thread_id?: string | null;
};

export function blankInvoiceDocument(today: string): InvoiceDocument {
  const due = new Date(`${today}T00:00:00Z`);
  return {
    sellerName: "Filazoo",
    sellerAddress: "",
    sellerTaxId: "",
    customerName: "",
    customerEmail: "",
    customerAddress: "",
    customerTaxId: "",
    currency: "USD",
    issueDate: today,
    dueDate: due.toISOString().slice(0, 10),
    reference: "",
    notes: "Payment terms: 100% payment before shipment unless otherwise agreed in writing.",
    paymentInstructions: "",
    discountMinor: 0,
    shippingMinor: 0,
    items: [{ description: "", quantity: 1, unitPriceMinor: 0, taxBps: 0 }],
  };
}

/** Allocate invoice discount proportionally before calculating line tax. Shipping is untaxed. */
export function invoiceTotals(doc: InvoiceDocument) {
  const subtotal = doc.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPriceMinor,
    0,
  );
  let allocated = 0;
  let cumulative = 0;
  const lines = doc.items.map((item) => {
    const gross = item.quantity * item.unitPriceMinor;
    cumulative += gross;
    // An editor can temporarily contain fractional quantities before validation.
    // Keep its preview usable; validated documents always take the exact path.
    const exact = [doc.discountMinor, cumulative, subtotal].every(
      Number.isSafeInteger,
    );
    const target = subtotal
      ? exact
        ? Number(
            (BigInt(doc.discountMinor) * BigInt(cumulative)) / BigInt(subtotal),
          )
        : Math.floor((doc.discountMinor * cumulative) / subtotal)
      : 0;
    const discount = target - allocated;
    allocated += discount;
    const net = gross - discount;
    const tax = Math.round((net * item.taxBps) / 10000);
    return { gross, discount, net, tax, total: net + tax };
  });
  const tax = lines.reduce((sum, line) => sum + line.tax, 0);
  return {
    subtotal,
    tax,
    total: subtotal - doc.discountMinor + tax + doc.shippingMinor,
    lines,
  };
}

export function invoiceLabel(invoice: Pick<Invoice, "number">) {
  return `INV-${String(invoice.number).padStart(6, "0")}`;
}
export function invoiceStatus(invoice: Invoice, today: string) {
  if (invoice.status !== "issued") return invoice.status;
  if (invoice.paid_minor >= invoice.total_minor) return "paid";
  if (invoice.document.dueDate < today) return "overdue";
  return invoice.paid_minor > 0 ? "partial" : "issued";
}
export function formatMoney(minor: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    minor / 100,
  );
}
export const paymentSchema = z.object({
  id: z.uuid(),
  amountMinor: money.refine(
    (value) => value > 0,
    "Payment must be greater than zero.",
  ),
  paidOn: date,
  method: z.enum(["bank_transfer", "cash", "card", "other"]),
  reference: z.string().trim().max(200),
});
export const invoiceMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    revision: z.number().int().positive(),
    document: invoiceDocumentSchema,
  }),
  z.object({
    action: z.enum(["issue", "void", "delete"]),
    revision: z.number().int().positive(),
  }),
  z.object({ action: z.literal("payment"), payment: paymentSchema }),
]);
