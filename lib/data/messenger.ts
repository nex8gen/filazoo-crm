import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { getMetaInboxData } from "../meta-messenger";
import { requireWorkspaceMember } from "../auth";
import { canCreateInvoices } from "../invoice-permissions";
import { defaultPortalDesign, portalDesignSchema, portalSectionEnabled } from "../portal-design";
import { websiteMessageThreads, type WebsiteMessageRow, type WebsiteInboxData, type MessengerInboxData } from "../messenger";

/** Uses the same workspace-scoped rows as both customer and staff portal routes. */
export async function getWebsiteInboxData(): Promise<WebsiteInboxData> {
  const db = createSupabaseAdmin();
  const [messages, portal] = await Promise.all([
    db.from("customer_portal_messages")
      .select("id,invoice_id,sender,body,created_at,invoice:invoices!inner(id,number,status,company_id,document)")
      .neq("invoice.status", "draft")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(500),
    db.from("workspace_portal_designs").select("published").eq("singleton", true).maybeSingle(),
  ]);
  if (messages.error || portal.error) throw new Error("Unable to load website conversations.");
  const threads = websiteMessageThreads((messages.data ?? []) as unknown as WebsiteMessageRow[]);
  const design = portal.data?.published ? portalDesignSchema.parse(portal.data.published) : defaultPortalDesign();
  // Invoice portals already serve the default design before a custom theme is published.
  return { threads, connected: portalSectionEnabled(design, "messages") };
}

export async function getMessengerInboxData(): Promise<MessengerInboxData> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [social, website] = await Promise.all([
    getMetaInboxData(),
    getWebsiteInboxData().then((data) => ({ data, error: null })).catch(() => ({ data: { threads: [], connected: false } as WebsiteInboxData, error: "Website messages could not be loaded." })),
  ]);
  return { ...social, threads: [...social.threads, ...website.data.threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    connection: { ...social.connection, webConfigured: website.data.connected },
    canReply: canCreateInvoices(viewer.role), websiteError: website.error };
}

