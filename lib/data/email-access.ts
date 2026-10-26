import type { WorkspaceViewer } from "../auth.ts";
import type { AssignedEmailContacts } from "../email-access.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

/** Read current pipeline ownership, including every contact on assigned companies. */
export async function getAssignedEmailContacts(viewer: Pick<WorkspaceViewer, "id" | "role">): Promise<AssignedEmailContacts> {
  if (viewer.role !== "bd_manager") return null;
  const admin = createSupabaseAdmin();
  const contacts = new Map<string, string>();
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from("contacts")
      .select("id,email,company_id,companies!inner(pipeline!inner(owner_id))")
      .eq("companies.pipeline.owner_id", viewer.id)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to verify email assignments: ${error.message}`);
    for (const contact of data ?? []) {
      const email = contact.email?.trim().toLowerCase();
      if (email) contacts.set(email, contact.company_id);
    }
    if ((data?.length ?? 0) < pageSize) return contacts;
  }
}
