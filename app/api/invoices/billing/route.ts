import { z } from "zod";
import {
  invoiceAccess,
  invoiceError,
  checkInvoiceOrigin,
} from "@/lib/invoice-api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
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
    const result =
      input.data.kind === "customer"
        ? await db
            .from("customer_billing_profiles")
            .upsert({
              company_id: input.data.companyId,
              profile: input.data.profile,
              updated_by: access.viewer.id,
              updated_at: new Date().toISOString(),
            })
        : await db
            .from("invoice_settings")
            .upsert({
              singleton: true,
              settings: input.data.settings,
              updated_by: access.viewer.id,
              updated_at: new Date().toISOString(),
            });
    if (result.error) throw result.error;
    return Response.json({ ok: true });
  } catch (error) {
    return invoiceError(error);
  }
}
