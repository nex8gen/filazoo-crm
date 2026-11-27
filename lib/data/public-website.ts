import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { createSupabaseControl } from "../supabase/control";
import { withWorkspaceContext } from "../workspace-context";
import { workspaceIdSchema } from "../workspaces";
import { portalDesignSchema } from "../portal-design";
import { publicWebsiteDesign } from "../portal-website-design";

/** The public address identifies a website, never a customer's access credential. */
export async function workspaceWebsitePath(workspaceId: string): Promise<string | undefined> {
  if (workspaceId === "legacy") {
    const { data, error } = await createSupabaseControl().from("workspaces").select("id").eq("is_legacy", true).maybeSingle();
    if (error || !data) return undefined;
    workspaceId = data.id;
  }
  const parsed = workspaceIdSchema.safeParse(workspaceId);
  return parsed.success ? `/website/${parsed.data}` : undefined;
}

/** Read only the publication, with both an explicit tenant filter and scoped RLS.
 * No auth cookies, drafts, account settings, invoices or conversations are read.
 */
export async function getPublicWebsite(workspaceId: string) {
  const parsedId = workspaceIdSchema.safeParse(workspaceId);
  if (!parsedId.success) return null;
  return withWorkspaceContext(parsedId.data, async () => {
    const { data, error } = await createSupabaseAdmin().from("workspace_portal_designs")
      .select("published").eq("workspace_id", parsedId.data).eq("singleton", true).maybeSingle();
    if (error) throw new Error("Unable to load this website. Please try again.");
    if (!data?.published) return null;
    const design = portalDesignSchema.safeParse(data.published);
    return design.success ? publicWebsiteDesign(design.data) : null;
  });
}
