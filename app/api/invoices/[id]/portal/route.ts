import { z } from "zod";
import { invoiceAccess, checkInvoiceOrigin, invoiceError } from "@/lib/invoice-api";
import { getInvoice } from "@/lib/data/invoices";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { shipmentSchema } from "@/lib/customer-portal";
import { portalHeaders } from "@/lib/data/customer-portal";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid invoice." }, { status: 400 });
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (companyId !== null && !z.uuid().safeParse(companyId).success) return Response.json({ error: "Invalid customer profile." }, { status: 400 });
  try {
    const invoice = await getInvoice(id);
    if (!invoice || (companyId && invoice.company_id !== companyId)) return Response.json({ error: "Invoice not found for this customer." }, { status: 404 });
    const db = createSupabaseAdmin();
    const [messages, shipment] = await Promise.all([
      db.from("customer_portal_messages").select("id,sender,body,created_at").eq("invoice_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100),
      db.from("customer_portal_shipments").select("status,location,carrier,tracking_number,tracking_url,expected_delivery,updated_at").eq("invoice_id", id).maybeSingle(),
    ]);
    if (messages.error) throw messages.error;
    if (shipment.error) throw shipment.error;
    return Response.json({ messages: (messages.data ?? []).reverse(), shipment: shipment.data }, { headers: portalHeaders });
  } catch (error) { return invoiceError(error); }
}
export async function POST(request: Request, context: Context) {
  const originError = checkInvoiceOrigin(request);
  if (originError) return originError;
  const access = await invoiceAccess("draft");
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid invoice." }, { status: 400 });
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (companyId !== null && !z.uuid().safeParse(companyId).success) return Response.json({ error: "Invalid customer profile." }, { status: 400 });
  const parsed = z.discriminatedUnion("action", [
    z.object({ action: z.literal("reply"), id: z.uuid(), body: z.string().trim().min(1).max(4000) }),
    z.object({ action: z.literal("shipment"), shipment: shipmentSchema }),
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    const invoice = await getInvoice(id);
    if (invoice && companyId && invoice.company_id !== companyId) return Response.json({ error: "Invoice not found for this customer." }, { status: 404 });
    if (!invoice || invoice.status === "draft") return Response.json({ error: "Issue this invoice before using its customer portal." }, { status: 409 });
    const db = createSupabaseAdmin();
    const input = parsed.data;
    const result = input.action === "reply"
      ? await db.from("customer_portal_messages").upsert({ id: input.id, invoice_id: id, sender: "staff", staff_id: access.viewer.id, body: input.body }, { onConflict: "id", ignoreDuplicates: true })
      : await db.from("customer_portal_shipments").upsert({ ...input.shipment, invoice_id: id, updated_by: access.viewer.id, updated_at: new Date().toISOString() });
    if (result.error) throw result.error;
    return Response.json({ ok: true }, { headers: portalHeaders });
  } catch (error) { return invoiceError(error); }
}
