import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoiceLabel, invoiceStatus, type Invoice } from "../invoices";
import { customerPortalUrl } from "../customer-portal-links";
import { portalEmail } from "../customer-portal-crypto";
import type { CompanyPortalData, CompanyPortalInvoice } from "../company-portal";

export async function getCompanyPortal(companyId: string, page = 0, invoiceId?: string): Promise<CompanyPortalData | null> {
  const db = createSupabaseAdmin();
  const [company, listing, selected, balances] = await Promise.all([
    db.from("companies").select("id").eq("id", companyId).maybeSingle(),
    db.from("invoices").select("*", { count: "exact" }).eq("company_id", companyId).neq("status", "draft").order("number", { ascending: false }).range(page * 25, page * 25 + 24),
    invoiceId ? db.from("invoices").select("*").eq("company_id", companyId).eq("id", invoiceId).neq("status", "draft").maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.rpc("invoice_receivables", { p_company_id: companyId, p_search: "", p_status: "" }),
  ]);
  for (const result of [company, listing, selected, balances]) if (result.error) throw result.error;
  if (!company.data) return null;
  const rows = [...new Map([...(listing.data ?? []), ...(selected.data ? [selected.data] : [])].map(row => [row.id, row as Invoice])).values()];
  const ids = rows.map(row => row.id);
  const emails = [...new Set(rows.map(row => portalEmail(row.document.customerEmail)).filter(Boolean))];
  const orderIds = [...new Set(rows.flatMap(row => row.document.purchaseOrderId ? [row.document.purchaseOrderId] : []))];
  const [accounts, shipments, orders] = await Promise.all([
    emails.length ? db.from("customer_portal_accounts").select("email,credential_version").in("email", emails) : Promise.resolve({ data: [], error: null }),
    ids.length ? db.from("customer_portal_shipments").select("invoice_id,status,location,carrier,tracking_number,tracking_url,expected_delivery,updated_at").in("invoice_id", ids) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? db.from("purchase_orders").select("id,reference,document").eq("company_id", companyId).in("id", orderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [accounts, shipments, orders]) if (result.error) throw result.error;
  const accountMap = new Map((accounts.data ?? []).map(row => [row.email, row.credential_version]));
  const shipmentMap = new Map((shipments.data ?? []).map(row => [row.invoice_id, row]));
  const orderMap = new Map((orders.data ?? []).map(row => [row.id, row]));
  const today = new Date().toISOString().slice(0, 10);
  const mapped = new Map<string, CompanyPortalInvoice>(rows.map(invoice => {
    const version = accountMap.get(portalEmail(invoice.document.customerEmail));
    const order = invoice.document.purchaseOrderId ? orderMap.get(invoice.document.purchaseOrderId) : null;
    return [invoice.id, { id: invoice.id, label: invoiceLabel(invoice), email: invoice.document.customerEmail, reference: invoice.document.reference, currency: invoice.document.currency, totalMinor: invoice.total_minor, paidMinor: invoice.paid_minor, status: invoiceStatus(invoice, today), dueDate: invoice.document.dueDate, portalUrl: customerPortalUrl(invoice), security: version === undefined ? "not_opened" : version > 0 ? "secured" : "password_needed", shipment: shipmentMap.get(invoice.id) ?? null, order: order ? { id: order.id, reference: order.reference, status: order.document.status, deliveryDate: order.document.deliveryDate } : null }];
  }));
  return { invoices: (listing.data ?? []).map(row => mapped.get(row.id)!), selected: invoiceId ? mapped.get(invoiceId) ?? null : null, count: listing.count ?? 0, page, balances: balances.data ?? [] };
}
