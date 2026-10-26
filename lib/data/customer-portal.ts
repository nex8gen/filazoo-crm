import "server-only";
import { cookies } from "next/headers";
import { createSupabaseAdmin } from "../supabase/admin";
import { getInvoice } from "./invoices";
import { customerInvoice, type PortalData } from "../customer-portal";
import { portalEmail, portalHash, portalToken } from "../customer-portal-crypto";

export const portalCookie = "filazoo_customer_session";
export class PortalError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const portalHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export function portalError(error: unknown) {
  if (error instanceof PortalError) return Response.json({ error: error.message }, { status: error.status, headers: portalHeaders });
  console.error("Customer portal operation failed", error);
  return Response.json({ error: "The customer portal is temporarily unavailable. Please try again or contact your sales team." }, { status: 503, headers: portalHeaders });
}
export function checkPortalOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new PortalError("Invalid request origin.", 403);
}
export async function portalLimit(key: string, maximum = 12) {
  const { data, error } = await createSupabaseAdmin().rpc("customer_portal_rate_limit", { p_key: portalHash(key), p_max: maximum });
  if (error) throw error;
  if (!data) throw new PortalError("Too many attempts. Please try again in 15 minutes.", 429);
}
export async function portalAccount(email: string) {
  const { data, error } = await createSupabaseAdmin().from("customer_portal_accounts").select("email,password_hash,credential_version").eq("email", portalEmail(email)).maybeSingle();
  if (error) throw error;
  return data as { email: string; password_hash: string | null; credential_version: number } | null;
}
export async function issuePortalSession(invoiceId: string, email: string, version: number, kind: "qr" | "member") {
  const db = createSupabaseAdmin();
  const token = portalToken();
  const maxAge = kind === "member" ? 7 * 86400 : 3600;
  const { error } = await db.from("customer_portal_sessions").insert({ token_hash: portalHash(token), invoice_id: invoiceId, email: portalEmail(email), credential_version: version, kind, expires_at: new Date(Date.now() + maxAge * 1000).toISOString() });
  if (error) throw error;
  const jar = await cookies();
  const old = jar.get(portalCookie)?.value;
  jar.set(portalCookie, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge });
  if (old) {
    const removed = await db.from("customer_portal_sessions").delete().eq("token_hash", portalHash(old));
    if (removed.error) throw removed.error;
  }
}
export async function portalSession(invoiceId?: string, challenge = false) {
  const token = (await cookies()).get(portalCookie)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PortalError("Scan your invoice QR code to open the customer portal.", 401);
  const { data: session, error } = await createSupabaseAdmin().from("customer_portal_sessions").select("invoice_id,email,kind,credential_version,expires_at").eq("token_hash", portalHash(token)).maybeSingle();
  if (error) throw error;
  if (!session || Date.parse(session.expires_at) <= Date.now() || (invoiceId && session.invoice_id !== invoiceId)) throw new PortalError("Your session expired. Please scan your invoice QR code again.", 401);
  const [account, invoice] = await Promise.all([portalAccount(session.email), getInvoice(session.invoice_id)]);
  if (!account || !invoice || invoice.status === "draft" || portalEmail(invoice.document.customerEmail) !== session.email) throw new PortalError("This customer link is no longer available.", 403);
  if (!challenge && account.password_hash && (session.kind !== "member" || session.credential_version !== account.credential_version)) throw new PortalError("Sign in with your customer password to continue.", 401);
  return { session, account, invoice };
}
export async function loadPortalData(id: string): Promise<PortalData> {
  const { account, invoice } = await portalSession(id);
  const db = createSupabaseAdmin();
  const [messages, shipment, order] = await Promise.all([
    db.from("customer_portal_messages").select("id,sender,body,created_at").eq("invoice_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100),
    db.from("customer_portal_shipments").select("status,location,carrier,tracking_number,tracking_url,expected_delivery,updated_at").eq("invoice_id", id).maybeSingle(),
    invoice.document.purchaseOrderId && invoice.company_id ? db.from("purchase_orders").select("reference,document").eq("id", invoice.document.purchaseOrderId).eq("company_id", invoice.company_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [messages, shipment, order]) if (result.error) throw result.error;
  return { invoice: customerInvoice(invoice), email: account.email, needsPassword: !account.password_hash, messages: (messages.data ?? []).reverse(), shipment: shipment.data, order: order.data && order.data.document.status !== "draft" ? { reference: order.data.reference, status: order.data.document.status, deliveryDate: order.data.document.deliveryDate } : null };
}
