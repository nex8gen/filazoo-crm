import { z } from "zod";
import { checkPortalOrigin, portalError, portalHeaders, portalLimit, portalSession, PortalError } from "@/lib/data/customer-portal";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    checkPortalOrigin(request);
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new PortalError("Invalid invoice.");
    await portalSession(id);
    const input = z.object({ id: z.uuid(), body: z.string().trim().min(1).max(4000) }).parse(await request.json());
    await portalLimit(`message:${id}`, 30);
    const { error } = await createSupabaseAdmin().from("customer_portal_messages").upsert({ id: input.id, invoice_id: id, sender: "customer", body: input.body }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    return Response.json({ ok: true }, { headers: portalHeaders });
  } catch (error) { return portalError(error instanceof z.ZodError ? new PortalError("Enter a message of 1–4,000 characters.") : error); }
}
