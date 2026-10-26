import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoicePaymentMethodsSchema } from "../invoice-payment-methods";

export async function invoicePaymentMethods() {
  const { data, error } = await createSupabaseAdmin().from("invoice_settings")
    .select("settings").eq("singleton", true).maybeSingle();
  if (error) throw error;
  return invoicePaymentMethodsSchema.parse(data?.settings?.paymentMethods ?? []);
}

// Compare the version before replacing JSON so payment and seller edits preserve each other.
export async function patchInvoiceSettings(patch: Record<string, unknown>, userId: string) {
  const db = createSupabaseAdmin();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await db.from("invoice_settings").select("settings,updated_at")
      .eq("singleton", true).maybeSingle();
    if (error) throw error;
    const updatedAt = new Date(Math.max(Date.now(), data ? Date.parse(data.updated_at) + 1 : 0)).toISOString();
    const row = { settings: { ...data?.settings, ...patch }, updated_by: userId, updated_at: updatedAt };
    if (!data) {
      const result = await db.from("invoice_settings").insert({ singleton: true, ...row });
      if (!result.error) return;
      if (result.error.code === "23505") continue;
      throw result.error;
    }
    const result = await db.from("invoice_settings").update(row)
      .eq("singleton", true).eq("updated_at", data.updated_at).select("singleton");
    if (result.error) throw result.error;
    if (result.data?.length) return;
  }
  throw Object.assign(new Error("Settings changed while saving. Please try again."), { code: "P0001" });
}
