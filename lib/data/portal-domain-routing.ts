import "server-only";
import { createSupabaseControl } from "../supabase/control";
import { createSupabaseAdmin } from "../supabase/admin";
import { isPlatformHost, portalRequestHost } from "../portal-domains";

export async function findPortalDomain(hostname: string) {
  const { data, error } = await createSupabaseControl().from("workspace_portal_domains").select("hostname,workspace_id,status").eq("hostname", hostname).maybeSingle();
  if (error) throw new Error("Unable to resolve the portal domain.");
  return data as { hostname: string; workspace_id: string; status: string } | null;
}
export async function assertPortalWorkspaceHost(request: Request, workspaceId: string) {
  const hostname = portalRequestHost(request.headers.get("host") || new URL(request.url).host);
  if (isPlatformHost(hostname)) return;
  const domain = await findPortalDomain(hostname);
  if (!domain || domain.status !== "connected" || domain.workspace_id !== workspaceId) throw new Error("This customer link does not belong to this portal domain.");
}
export async function connectedPortalOrigin() {
  const { data, error } = await createSupabaseAdmin().from("workspace_portal_domains").select("hostname").eq("status", "connected").maybeSingle();
  if (error) throw new Error("Unable to load the customer portal domain.");
  return data ? `https://${data.hostname}` : undefined;
}
