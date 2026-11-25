import "server-only";
import { z } from "zod";
import { requireWorkspaceMember } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { purchaseOrderSchema } from "../purchase-orders";
import type { AnalysisOrder, CompanyAnalysisData } from "../company-analysis";
import { getCompanyEmailScope } from "./company-email-access";
import { getCompanyEmailBackendData } from "./company-emails";

export async function getCompanyAnalysis(companyId: string): Promise<CompanyAnalysisData> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  z.uuid().parse(companyId);
  const company = await getCompanyEmailScope(viewer, companyId);
  if (!company) throw new Error("Company unavailable.");
  const db = createSupabaseAdmin();
  const emailPromise = (async () => {
    let email: CompanyAnalysisData["email"] = { messages: [], available: false, partial: false };
    try {
      const history = await getCompanyEmailBackendData(company);
      email = {
        available: !history.mailboxReadFailed,
        partial: Boolean(history.mailboxSnapshotPartial || history.mailboxHistoryPartial || history.inboxError),
        messages: history.emails.filter(message => message.direction === "inbound" || message.status.toLowerCase() === "sent")
          .map(({ id, direction, timestamp, threadId, messageId, inReplyTo, references, automaticResponse }) =>
            ({ id, direction, timestamp, threadId, messageId, inReplyTo, references, automaticResponse })),
      };
    } catch { /* Keep purchase reports available when correspondence cannot be read. */ }
    return email;
  })();
  const orders: AnalysisOrder[] = [];
  // Read every page. PostgREST's row limit must never silently truncate totals.
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("purchase_orders")
      .select("id,document").eq("company_id", companyId)
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw new Error("Purchase analysis could not be loaded. Please try again.");
    for (const row of data ?? []) {
      const document = purchaseOrderSchema.parse(row.document);
      orders.push({
        id: row.id, reference: document.reference, orderDate: document.orderDate,
        deliveryDate: document.deliveryDate, currency: document.currency, status: document.status,
        items: document.items.map(({ description, sku, productSku, variantId, quantity, unitPriceMinor }) => ({ description, sku, productSku, variantId, quantity, unitPriceMinor })),
      });
    }
    if ((data?.length ?? 0) < pageSize) break;
  }
  const skus = [...new Set(orders.flatMap(order => order.items.flatMap(item => item.productSku ? [item.productSku] : [])))];
  const products: CompanyAnalysisData["products"] = [];
  for (let i = 0; i < skus.length; i += 100) {
    const { data, error } = await db.from("products").select("sku,name").in("sku", skus.slice(i, i + 100));
    if (error) throw new Error("Product names could not be loaded. Please try again.");
    products.push(...(data ?? []));
  }
  const tasks: CompanyAnalysisData["tasks"] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("crm_tasks").select("id,notes,due_at")
      .eq("company_id", companyId).eq("status", "open").like("notes", "Company purchase analysis: %")
      .order("id").range(offset, offset + pageSize - 1);
    if (error) throw new Error("Product follow-ups could not be loaded. Please try again.");
    tasks.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  const email = await emailPromise;
  return { orders, products, tasks, email, asOf: new Date().toISOString() };
}
