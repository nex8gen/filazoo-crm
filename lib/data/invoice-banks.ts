import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoiceBankAccountSchema } from "../invoice-banks";

export async function invoiceBankAccounts() {
  const { data, error } = await createSupabaseAdmin()
    .from("invoice_bank_accounts")
    .select("id,label,currency,details")
    .eq("active", true)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((account) => invoiceBankAccountSchema.parse({
    ...account.details, id: account.id, label: account.label, currency: account.currency,
  }));
}
