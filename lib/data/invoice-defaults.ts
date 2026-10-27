import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { readInvoiceDefaults } from "../invoice-defaults";

export async function getInvoiceDefaults() {
  const { data, error } = await createSupabaseAdmin().from("invoice_settings").select("settings").eq("singleton", true).maybeSingle();
  if (error) throw error;
  return readInvoiceDefaults(data?.settings ?? {});
}
