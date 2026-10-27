import { z } from "zod";
import {
  invoiceAccess,
  invoiceError,
  checkInvoiceOrigin,
} from "@/lib/invoice-api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { patchInvoiceSettings } from "@/lib/data/invoice-payment-methods";
import { invoicePaymentMethodsSchema } from "@/lib/invoice-payment-methods";
import { invoiceDefaultsSchema } from "@/lib/invoice-defaults";
import {
  billingProfileSchema,
  sellerSettingsSchema,
} from "@/lib/invoice-links";

const inputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("customer"),
    companyId: z.uuid(),
    profile: billingProfileSchema,
  }),
  z.object({ kind: z.literal("seller"), settings: sellerSettingsSchema }),
  z.object({ kind: z.literal("payments"), paymentMethods: invoicePaymentMethodsSchema }),
  z.object({ kind: z.literal("invoice_defaults"), settings: sellerSettingsSchema, defaults: invoiceDefaultsSchema }),
]);
export async function PUT(request: Request) {
  const origin = checkInvoiceOrigin(request);
  if (origin) return origin;
  const access = await invoiceAccess(true);
  if (access.response) return access.response;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: input.error.issues[0]?.message },
      { status: 400 },
    );
  const db = createSupabaseAdmin();
  try {
    if (input.data.kind !== "customer") {
      await patchInvoiceSettings(input.data.kind === "payments"
        ? { paymentMethods: input.data.paymentMethods } : input.data.kind === "invoice_defaults"
          ? { ...input.data.settings, defaults: input.data.defaults } : input.data.settings, access.viewer.id);
      return Response.json({ ok: true });
    }
    const existing = input.data.kind === "customer"
      ? await db.from("customer_billing_profiles").select("profile").eq("company_id", input.data.companyId).maybeSingle()
      : null;
    if (existing?.error) throw existing.error;
    const result =
      input.data.kind === "customer"
        ? await db
            .from("customer_billing_profiles")
            .upsert({
              company_id: input.data.companyId,
              profile: { ...existing?.data?.profile, ...input.data.profile },
              updated_by: access.viewer.id,
              updated_at: new Date().toISOString(),
            })
        : null;
    if (result?.error) throw result.error;
    return Response.json({ ok: true });
  } catch (error) {
    return invoiceError(error);
  }
}
