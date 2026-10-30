import type { SupabaseClient } from "@supabase/supabase-js";
import { companyPaidOrderCounts, type CompanyOrderInvoice } from "../company-orders.ts";

/** Server reader; callers authorize the company read before passing an admin client. */
export async function readCompanyPaidOrderCounts(db: SupabaseClient, companyIds: readonly string[]) {
  const ids = [...new Set(companyIds)];
  const counts = new Map<string, number>();
  // Bound URL sizes and read every page, including projects with a smaller API cap.
  for (let batch = 0; batch < ids.length; batch += 100) {
    const invoices: CompanyOrderInvoice[] = [];
    for (let from = 0; ;) {
      const { data, error, count } = await db.from("invoices")
        .select("id,company_id,purchase_order_id,status,total_minor,paid_minor", { count: "exact" })
        .in("company_id", ids.slice(batch, batch + 100)).eq("status", "issued").gt("paid_minor", 0)
        .order("id").range(from, from + 499);
      if (error) throw new Error(`Unable to load paid order counts: ${error.message}`);
      invoices.push(...(data ?? []) as CompanyOrderInvoice[]);
      from += data?.length ?? 0;
      if (!data?.length || (count !== null && from >= count)) break;
    }
    for (const [id, count] of companyPaidOrderCounts(invoices)) counts.set(id, count);
  }
  return counts;
}
