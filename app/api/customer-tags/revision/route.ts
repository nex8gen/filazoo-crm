import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAssignedEmailContacts } from "@/lib/data/email-access";

/** A small freshness probe; no mailbox contents or customer addresses leave this endpoint. */
export async function GET() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const assigned = await getAssignedEmailContacts(viewer);
  const companyIds = assigned ? [...new Set(assigned.values())] : null;
  let latest = "empty";
  if (!companyIds || companyIds.length) {
    const db = createSupabaseAdmin();
    // Bound URL sizes for managers with many assigned customers.
    for (let start = 0; start < (companyIds?.length ?? 1); start += 100) {
      let query = db.from("crm_email_tags").select("updated_at").not("company_id", "is", null);
      if (companyIds) query = query.in("company_id", companyIds.slice(start, start + 100));
      const { data } = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle().throwOnError();
      if (data?.updated_at && (latest === "empty" || data.updated_at > latest)) latest = data.updated_at;
    }
  }
  return Response.json({ revision: `${viewer.workspaceId}:${latest}` }, { headers: { "Cache-Control": "private, no-store" } });
}
