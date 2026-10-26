import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getInvoice } from "@/lib/data/invoices";
import { portalEmail } from "@/lib/customer-portal-crypto";
import { portalError, portalHeaders } from "@/lib/data/customer-portal";

// Compatibility for the invoice UUID bearer links printed before the customer
// portal existed. The snapshot prevents this becoming a link-minting endpoint
// for new invoices or invoices whose billing identity has since changed.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const unavailable = () => new Response("This customer invoice link is no longer available. Please ask your sales team for an updated invoice QR code.", { status: 404, headers: { ...portalHeaders, "Content-Type": "text/plain; charset=utf-8" } });
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return unavailable();
    const { data: legacy, error } = await createSupabaseAdmin().from("customer_portal_legacy_links").select("billing_email").eq("invoice_id", id).is("revoked_at", null).maybeSingle();
    if (error) throw error;
    if (!legacy) return unavailable();
    const invoice = await getInvoice(id);
    if (!invoice || !invoice.customer_portal_url || portalEmail(invoice.document.customerEmail) !== legacy.billing_email) return unavailable();
    const signed = new URL(invoice.customer_portal_url);
    // Keep the visitor on the origin they scanned, including a staged release.
    const destination = new URL(signed.pathname + signed.hash, request.url);
    return NextResponse.redirect(destination, { status: 307, headers: portalHeaders });
  } catch (error) { return portalError(error); }
}
