import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

export type WorkspaceActivity = { id: string; actor_name: string | null; actor_id: string | null; area: string; operation: string; target_label: string | null; changed_fields: string[]; created_at: string };
export async function listWorkspaceActivity(page = 1) {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.workspaceId === "legacy") return { entries: [], hasMore: false };
  const offset = (Math.max(1, Math.min(10000, Math.floor(page))) - 1) * 50;
  const { data, error } = await createSupabaseAdmin().from("workspace_activity")
    .select("id,actor_name,actor_id,area,operation,target_label,changed_fields,created_at")
    .eq("workspace_id", viewer.workspaceId).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 50);
  if (error) throw new Error("Unable to load workspace activity. Please try again.");
  return { entries: (data ?? []).slice(0, 50) as WorkspaceActivity[], hasMore: (data?.length ?? 0) > 50 };
}
