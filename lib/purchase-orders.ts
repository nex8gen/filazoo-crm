import { z } from "zod";
import { invoiceCurrencies, invoiceDocumentSchema } from "./invoices.ts";

export const poStatuses = [
  "draft",
  "confirmed",
  "in_production",
  "shipped",
  "completed",
  "cancelled",
] as const;
export const poStatusLabels: Record<(typeof poStatuses)[number], string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  in_production: "In production",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
};
const date = z.iso.date();
export const orderCustomerSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactId: z.uuid().optional(),
  contactName: z.string().trim().max(160),
  contactRole: z.string().trim().max(120),
  contactEmail: z.union([z.email(), z.literal("")]),
  billingEmail: z.union([z.email(), z.literal("")]),
  billingAddress: z.string().trim().max(2000),
  taxId: z.string().trim().max(100),
  phone: z.string().trim().max(80),
});
export type OrderCustomer = z.infer<typeof orderCustomerSchema>;
export type OrderProfile = {
  country?: string;
  customer: OrderCustomer;
  commerce: import("./company-commerce.ts").CompanyCommerce;
  contacts: { id: string; name: string; role: string; email: string }[];
};
export const orderBillingSchema = z.object({
  issueDate: invoiceDocumentSchema.shape.issueDate,
  dueDate: invoiceDocumentSchema.shape.dueDate,
  discountMinor: invoiceDocumentSchema.shape.discountMinor,
  taxBps: z.number().int().min(0).max(10000),
  paymentMethods: invoiceDocumentSchema.shape.paymentMethods,
}).strict();
export type OrderBilling = z.infer<typeof orderBillingSchema>;
export const purchaseOrderSchema = z
  .object({
    customer: orderCustomerSchema.optional(),
    billing: orderBillingSchema.optional(),
    reference: z
      .string()
      .trim()
      .min(1, "Enter the customer's PO number.")
      .max(100),
    orderDate: date,
    deliveryDate: z.union([date, z.literal("")]),
    currency: z.enum(invoiceCurrencies),
    status: z.enum(poStatuses),
    paymentPolicy: z
      .enum(["full_before_shipment", "custom"])
      .default("full_before_shipment"),
    preShipmentPercent: z.number().int().min(0).max(100).default(100),
    paymentTerms: z.string().trim().max(2000).default(""),
    shippingAddress: z.string().trim().max(2000),
    shippingRecipient: z.string().trim().max(160),
    shippingPhone: z.string().trim().max(80),
    notes: z.string().trim().max(5000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          sku: z.string().trim().max(200),
          productSku: z.string().trim().min(1).max(200).optional(),
          variantId: z.string().trim().min(1).max(200).optional(),
          variantSku: z.string().trim().max(200).optional(),
          imageUrl: z
            .string()
            .max(1000)
            .refine(
              (value) =>
                z.url().safeParse(value).success ||
                /^\/[A-Za-z0-9/_-]+\.[A-Za-z0-9]+$/.test(value),
              "Invalid product image",
            )
            .optional(),
          pricingMode: z.enum(["catalog", "manual"]).optional(),
          quantity: z.number().int().min(1).max(1_000_000),
          unitPriceMinor: z.number().int().min(0).max(100_000_000),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (po) =>
      po.items.every(
        (item) =>
          !(
            item.variantId ||
            item.variantSku ||
            item.pricingMode === "catalog"
          ) || Boolean(item.productSku),
      ),
    "Select a catalog product before selecting its variant or catalog pricing.",
  )
  .refine((po) => !po.deliveryDate || po.deliveryDate >= po.orderDate, {
    message: "Delivery date must be on or after the order date.",
    path: ["deliveryDate"],
  })
  .refine((po) => po.paymentPolicy !== "custom" || po.paymentTerms.length > 0, {
    message: "Describe the agreed payment terms for this exception.",
    path: ["paymentTerms"],
  })
  .refine(
    (po) => purchaseOrderTotal(po.items) <= 1_000_000_000_000,
    "Order total is too large.",
  )
  .superRefine((po, ctx) => {
    const billing = po.billing;
    if (!billing) return;
    if (billing.dueDate < billing.issueDate) ctx.addIssue({ code: "custom", message: "Due date must be on or after the issue date.", path: ["billing", "dueDate"] });
    if (billing.discountMinor > purchaseOrderTotal(po.items)) ctx.addIssue({ code: "custom", message: "Discount cannot exceed the order subtotal.", path: ["billing", "discountMinor"] });
    if (billing.paymentMethods?.some(method => method.currency && method.currency !== po.currency)) ctx.addIssue({ code: "custom", message: "Choose payment methods for the order currency.", path: ["billing", "paymentMethods"] });
  });
export type PurchaseOrderDocument = z.infer<typeof purchaseOrderSchema>;
// A new order may omit the customer's external reference; the database fills it
// from the generated order number before applying the stored-document constraints.
export const purchaseOrderCreateSchema = purchaseOrderSchema.safeExtend({ reference: z.string().trim().max(100) });
export type PurchaseOrder = {
  number?: number;
  invoices?: OrderInvoice[];
  id: string;
  company_id: string;
  version: number;
  document: PurchaseOrderDocument;
  total_minor: number;
  created_at: string;
  updated_at?: string;
};
export type PurchaseOrderActivity = { id: string; createdAt: string; type: string; summary: string };
export function purchaseOrderLabel(order: Pick<PurchaseOrder, "number" | "document">) {
  return order.number ? `#${order.number}` : order.document.reference;
}
export type OrderInvoice = {
  id: string;
  order_managed?: boolean;
  last_sent_at?: string | null;
  number: number;
  status: "draft" | "issued" | "void";
  total_minor: number;
  paid_minor: number;
  document: {
    purchaseOrderId?: string;
    currency: string;
    items: { purchaseOrderLineId?: string; quantity: number }[];
  };
};
export function orderInvoiceLocksDetails(invoice: OrderInvoice) {
  return invoice.status === "issued" || (invoice.status === "draft" && !invoice.order_managed);
}
export function orderLineId(index: number) {
  return `line-${index + 1}`;
}
export function orderHasUnreservedItems(order: PurchaseOrder) {
  const summary = orderBillingSummary(order);
  return order.document.items.some(
    (item, index) => item.quantity > (summary.quantities.get(orderLineId(index)) ?? 0),
  );
}
export function orderBillingSummary(order: PurchaseOrder) {
  const invoices = order.invoices ?? [];
  const issued = invoices.filter((invoice) => invoice.status === "issued");
  const quantities = new Map<string, number>();
  for (const invoice of invoices.filter((invoice) => invoice.status !== "void"))
    for (const item of invoice.document.items)
      if (item.purchaseOrderLineId)
        quantities.set(
          item.purchaseOrderLineId,
          (quantities.get(item.purchaseOrderLineId) ?? 0) + item.quantity,
        );
  const issuedQuantities = new Map<string, number>();
  for (const invoice of issued)
    for (const item of invoice.document.items)
      if (item.purchaseOrderLineId)
        issuedQuantities.set(
          item.purchaseOrderLineId,
          (issuedQuantities.get(item.purchaseOrderLineId) ?? 0) + item.quantity,
        );
  const total = issued.reduce((sum, invoice) => sum + invoice.total_minor, 0);
  const paid = issued.reduce((sum, invoice) => sum + invoice.paid_minor, 0);
  const fullyInvoiced = order.document.items.every(
    (item, index) =>
      (issuedQuantities.get(orderLineId(index)) ?? 0) >= item.quantity,
  );
  const percent =
    order.document.paymentPolicy === "custom"
      ? order.document.preShipmentPercent
      : 100;
  return {
    total,
    paid,
    outstanding: total - paid,
    fullyInvoiced,
    quantities,
    canShip:
      percent === 0 ||
      (fullyInvoiced && total > 0 && paid >= Math.ceil((total * percent) / 100)),
  };
}
export function purchaseOrderTotal(
  items: { quantity: number; unitPriceMinor: number }[],
): number {
  return items.reduce(
    (total, item) => total + item.quantity * item.unitPriceMinor,
    0,
  );
}
