import type { PortalShipment } from "./customer-portal.ts";
export type CompanyPortalInvoice = {
  id: string; label: string; email: string; reference: string; currency: string;
  totalMinor: number; paidMinor: number; status: string; dueDate: string;
  portalUrl?: string; security: "not_opened" | "password_needed" | "secured";
  shipment: PortalShipment | null;
  order: { id: string; reference: string; status: string; deliveryDate: string } | null;
};
export type CompanyPortalData = {
  invoices: CompanyPortalInvoice[]; selected: CompanyPortalInvoice | null; count: number; page: number;
  balances: { currency: string; outstanding_minor: number; paid_minor: number }[];
};
export function companyPortalHref(companyId: string, invoiceId?: string) {
  const query = new URLSearchParams({ tab: "customer-portal" });
  if (invoiceId) query.set("invoiceId", invoiceId);
  return `/companies/${encodeURIComponent(companyId)}?${query}`;
}
