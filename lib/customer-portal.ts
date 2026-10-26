import { z } from "zod";
import type { Invoice } from "./invoices.ts";

export const shipmentStatuses = ["preparing", "in_transit", "out_for_delivery", "delivered", "exception"] as const;
export const shipmentLabels: Record<typeof shipmentStatuses[number], string> = {
  preparing: "Preparing your order", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered", exception: "Delivery update required",
};
export const shipmentSchema = z.object({
  status: z.enum(shipmentStatuses),
  location: z.string().trim().max(200),
  carrier: z.string().trim().max(100),
  tracking_number: z.string().trim().max(200),
  tracking_url: z.union([z.url().max(2000).refine(value => new URL(value).protocol === "https:", "Use an HTTPS tracking link."), z.literal("")]),
  expected_delivery: z.union([z.iso.date(), z.literal("")]),
});
export type PortalShipment = z.infer<typeof shipmentSchema> & { updated_at?: string };
export type PortalMessage = { id: string; sender: "customer" | "staff"; body: string; created_at: string };
export type PortalInvoice = Pick<Invoice, "id" | "number" | "status" | "paid_minor" | "total_minor" | "document" | "creator_name" | "revision" | "created_at" | "updated_at">;
export type PortalData = {
  invoice: PortalInvoice;
  email: string;
  needsPassword: boolean;
  messages: PortalMessage[];
  shipment: PortalShipment | null;
  order: { reference: string; status: string; deliveryDate: string } | null;
};
// Explicitly exclude CRM IDs, source email threads, staff IDs and payment references.
export function customerInvoice(invoice: Invoice): PortalInvoice {
  const { companyId: _company, contactId: _contact, purchaseOrderId: _order, sourceThreadId: _thread, bankAccountId: _bank, ...document } = invoice.document;
  void [_company, _contact, _order, _thread, _bank];
  return { id: invoice.id, number: invoice.number, status: invoice.status, paid_minor: invoice.paid_minor, total_minor: invoice.total_minor, document, creator_name: invoice.creator_name, revision: invoice.revision, created_at: invoice.created_at, updated_at: invoice.updated_at };
}
