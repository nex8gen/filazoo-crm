import type { SupabaseClient } from "@supabase/supabase-js";
import { companyPaidOrderCounts, type CompanyOrderInvoice } from "../company-orders.ts";

/** Server reader; callers authorize the company read before passing an admin client. */
export async function readCompanyPaidOrderCounts(db: SupabaseClient, companyIds: readonly string[]) {
  const ids = [...new Set(companyIds)];
  const counts = new Map<string, number>();
  // Bound URL sizes and read every page, including projects with a smaller API cap.
  // Independent company batches may run together; pagination within each batch
  // stays sequential so smaller project API caps cannot drop invoices.
  async function readBatch(companyIds: string[]) {
    const invoices: CompanyOrderInvoice[] = [];
    for (let from = 0; ;) {
      const { data, error, count } = await db.from("invoices")
        .select("id,company_id,purchase_order_id,status,total_minor,paid_minor", { count: "exact" })
        .in("company_id", companyIds).eq("status", "issued").gt("paid_minor", 0)
        .order("id").range(from, from + 499);
      if (error) throw new Error(`Unable to load paid order counts: ${error.message}`);
      invoices.push(...(data ?? []) as CompanyOrderInvoice[]);
      from += data?.length ?? 0;
      if (!data?.length || (count !== null && from >= count)) break;
    }
    return companyPaidOrderCounts(invoices);
  }
  for (let start = 0; start < ids.length; start += 400) {
    const batches = [];
    for (let offset = start; offset < Math.min(start + 400, ids.length); offset += 100) {
      batches.push(readBatch(ids.slice(offset, offset + 100)));
    }
    for (const batch of await Promise.all(batches)) {
      for (const [id, count] of batch) counts.set(id, count);
    }
  }
  return counts;
}
