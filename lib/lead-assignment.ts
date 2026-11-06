import type { SupabaseClient } from "@supabase/supabase-js";

export async function claimNextBdSalesManager(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.rpc("claim_next_bd_sales_manager");
  if (error) {
    console.error("Automatic BD lead assignment is unavailable:", error.message);
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

export async function assignIncomingCompany(admin: SupabaseClient, companyId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("assign_incoming_company", { p_company_id: companyId });
  if (error) throw new Error(`Unable to assign incoming company: ${error.message}`);
  return typeof data === "string" && data.length > 0 ? data : null;
}
