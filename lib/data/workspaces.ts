import { requireViewer, getWorkspaceViewer } from "../auth.ts";
import { createSupabaseControl } from "../supabase/control.ts";
import type { WorkspaceSummary } from "../workspaces.ts";

export async function listMyWorkspaces(): Promise<WorkspaceSummary[]> {
  const viewer = await requireViewer();
  const member = await getWorkspaceViewer();
  if (member?.workspaceId === "legacy") return [{ id: "legacy", name: member.workspaceName, slug: "filazoo", role: member.role, ownerId: member.ownerId }];
  const { data, error } = await createSupabaseControl().from("workspace_members")
    .select("role,workspaces!inner(id,name,slug,owner_id)").eq("user_id", viewer.id).not("activated_at", "is", null).order("created_at");
  if (error?.code === "PGRST200" || error?.code === "PGRST205" || error?.code === "42P01") return [];
  if (error) throw new Error("Unable to load your workspaces. Please try again.");
  return (data ?? []).flatMap(row => {
    const w = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    return w ? [{ id: w.id, name: w.name, slug: w.slug, role: row.role, ownerId: w.owner_id }] : [];
  });
}
