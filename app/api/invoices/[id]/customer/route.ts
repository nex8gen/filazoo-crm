import { z } from "zod";
import { invoiceAccess, checkInvoiceOrigin, invoiceError } from "@/lib/invoice-api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { companyPortalHref } from "@/lib/company-portal";
import { revalidatePath } from "next/cache";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = checkInvoiceOrigin(request);
  if (originError) return originError;
  const access = await invoiceAccess("draft");
  if (access.response) return access.response;
  const { id } = await context.params;
  const input = z.discriminatedUnion("action", [z.object({ action: z.literal("create-profile") }), z.object({ action: z.literal("link-profile"), companyId: z.uuid() })]).safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !input.success) return Response.json({ error: "Choose a valid customer profile." }, { status: 400 });
  try {
    const { data: companyId, error } = await createSupabaseAdmin().rpc("connect_portal_invoice_customer", { p_invoice_id: id, p_actor_id: access.viewer.id, p_company_id: input.data.action === "link-profile" ? input.data.companyId : null });
    if (error) throw error;
    revalidatePath("/companies"); revalidatePath(`/companies/${companyId}`); revalidatePath(`/invoices/${id}`);
    return Response.json({ companyId, href: companyPortalHref(companyId, id) });
  } catch (error) { return invoiceError(error); }
}
