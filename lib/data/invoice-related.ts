import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { literalInvoiceEmail, relatedInvoiceOrder } from "../invoice-related";
import type { Invoice } from "../invoices";

export async function relatedInvoices(input: { companyId?: string; email?: string; threadId?: string }) {
  const db = createSupabaseAdmin();
  let emailQuery = input.email ? db.from("invoices").select("*")
    .ilike("document->>customerEmail", literalInvoiceEmail(input.email))
    .order("created_at", { ascending: false }).limit(25) : null;
  // Include older, unlinked invoices without mixing in another company's history.
  if (emailQuery && input.companyId) emailQuery = emailQuery.is("company_id", null);
  const groups = await Promise.all([
    input.threadId ? db.from("invoices").select("*").eq("source_thread_id", input.threadId)
      .order("created_at", { ascending: false }).limit(25) : Promise.resolve({ data: [], error: null }),
    input.companyId ? db.from("invoices").select("*").eq("company_id", input.companyId)
      .order("created_at", { ascending: false }).limit(25) : Promise.resolve({ data: [], error: null }),
    emailQuery ?? Promise.resolve({ data: [], error: null }),
  ]);
  for (const group of groups) if (group.error) throw group.error;
  return relatedInvoiceOrder(groups.map((group) => (group.data ?? []) as Invoice[]), input.threadId);
}
