import { cookies } from "next/headers";
import { createSupabaseControl } from "../supabase/control";
import { withWorkspaceContext } from "../workspace-context";
import { customerPortalSecret } from "../customer-portal-links";
import { portalHash, validPortalKey } from "../customer-portal-crypto";
import { checkPortalOrigin, portalCookie, portalError, PortalError } from "./customer-portal";

/** Resolve a workspace only from a valid invoice capability or opaque customer session. */
export async function withCustomerWorkspace(request: Request, work: () => Promise<Response>, opening = false) {
  try {
    if (request.method !== "GET") checkPortalOrigin(request);
    const control = createSupabaseControl();
    let workspaceId: string;
    if (opening) {
      const input = await request.clone().json();
      if (typeof input.invoiceId !== "string" || !/^[\da-f-]{36}$/i.test(input.invoiceId) || typeof input.key !== "string" || input.key.length > 100) throw new PortalError("Invalid customer link.", 403);
      const { data, error } = await control.from("invoices").select("id,workspace_id,document").eq("id", input.invoiceId).maybeSingle();
      if (error) throw error;
      if (!data || !validPortalKey(input.key, data.id, data.document.customerEmail, customerPortalSecret())) throw new PortalError("This customer link is invalid.", 403);
      workspaceId = data.workspace_id;
    } else {
      const token = (await cookies()).get(portalCookie)?.value;
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        if (request.method === "DELETE") return work();
        throw new PortalError("Your customer session has expired. Scan your invoice QR code again.", 401);
      }
      const { data, error } = await control.from("customer_portal_sessions").select("workspace_id,expires_at").eq("token_hash", portalHash(token)).maybeSingle();
      if (error) throw error;
      if (!data || Date.parse(data.expires_at) <= Date.now()) throw new PortalError("Your customer session has expired.", 401);
      workspaceId = data.workspace_id;
    }
    return await withWorkspaceContext(workspaceId, work);
  } catch (error) { return portalError(error); }
}
