import { z } from "zod";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getInvoice } from "@/lib/data/invoices";
import { checkPortalOrigin, issuePortalSession, portalAccount, portalCookie, portalError, portalHeaders, portalLimit, portalSession, PortalError } from "@/lib/data/customer-portal";
import { customerPortalSecret } from "@/lib/customer-portal-links";
import { hashPortalPassword, portalEmail, portalHash, validPortalKey, verifyPortalPassword } from "@/lib/customer-portal-crypto";
import { passwordSchema } from "@/lib/password";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    checkPortalOrigin(request);
    const input = z.object({ invoiceId: z.uuid(), key: z.string().max(100) }).parse(await request.json());
    const invoice = await getInvoice(input.invoiceId);
    if (!invoice || !invoice.document.customerEmail || !validPortalKey(input.key, invoice.id, invoice.document.customerEmail, customerPortalSecret())) throw new PortalError("This customer link is invalid. Ask your sales team for a new invoice QR code.", 403);
    if (invoice.status === "draft") throw new PortalError("This invoice has not been issued yet. Your customer portal will be available once it is issued.", 403);
    await portalLimit(`scan:${invoice.id}`, 40);
    const email = portalEmail(invoice.document.customerEmail);
    const db = createSupabaseAdmin();
    const created = await db.from("customer_portal_accounts").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });
    if (created.error) throw created.error;
    const account = await portalAccount(email);
    if (!account) throw new PortalError("Unable to open customer account.", 503);
    await issuePortalSession(invoice.id, email, account.credential_version, "qr");
    return Response.json({ email, requiresLogin: Boolean(account.password_hash) }, { headers: portalHeaders });
  } catch (error) { return portalError(error instanceof z.ZodError ? new PortalError("Invalid customer link.") : error); }
}
export async function PATCH(request: Request) {
  try {
    checkPortalOrigin(request);
    const input = z.object({ action: z.enum(["set-password", "login"]), password: z.string().min(1).max(128) }).parse(await request.json());
    const { session, account } = await portalSession(undefined, true);
    await portalLimit(`password:${account.email}`, 10);
    if (input.action === "set-password") {
      if (account.password_hash || session.kind !== "qr") throw new PortalError("Your account already has a password. Sign in to continue.", 409);
      const parsed = passwordSchema.safeParse(input.password);
      if (!parsed.success) throw new PortalError(parsed.error.issues[0].message);
      const hash = await hashPortalPassword(parsed.data);
      // Compare-and-set prevents simultaneous QR visitors from replacing a claimed password.
      const { data, error } = await createSupabaseAdmin().from("customer_portal_accounts").update({ password_hash: hash, credential_version: account.credential_version + 1 }).eq("email", account.email).is("password_hash", null).select("credential_version").maybeSingle();
      if (error) throw error;
      if (!data) throw new PortalError("A password was already set. Sign in to continue.", 409);
      await issuePortalSession(session.invoice_id, account.email, data.credential_version, "member");
    } else {
      if (!account.password_hash || !await verifyPortalPassword(input.password, account.password_hash)) throw new PortalError("Incorrect customer password.", 401);
      await issuePortalSession(session.invoice_id, account.email, account.credential_version, "member");
    }
    return Response.json({ ok: true }, { headers: portalHeaders });
  } catch (error) { return portalError(error instanceof z.ZodError ? new PortalError("Enter a valid password.") : error); }
}
export async function DELETE(request: Request) {
  try {
    checkPortalOrigin(request);
    const jar = await cookies();
    const token = jar.get(portalCookie)?.value;
    if (token) {
      const { error } = await createSupabaseAdmin().from("customer_portal_sessions").delete().eq("token_hash", portalHash(token));
      if (error) throw error;
    }
    jar.delete(portalCookie);
    return Response.json({ ok: true }, { headers: portalHeaders });
  } catch (error) { return portalError(error); }
}
