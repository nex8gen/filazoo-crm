import "server-only";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";

const taskRoles = ["admin", "operator", "bd_manager"];

export async function listTaskAssignees(viewer: WorkspaceViewer) {
  if (!taskRoles.includes(viewer.role)) throw new Error("Your workspace role is read-only.");
  const { data, error } = await createSupabaseAdmin().from("workspace_members")
    .select("user_id,display_name,role").in("role", taskRoles).not("activated_at", "is", null).order("display_name");
  if (error) throw new Error("Unable to load workspace users. Please try again.");
  return (data ?? []).map(member => ({ id: member.user_id, name: member.display_name?.trim() || (member.user_id === viewer.id ? "Me" : "Workspace member"), role: member.role }));
}

export async function validateTaskAssignee(id: string) {
  const { data, error } = await createSupabaseAdmin().from("workspace_members").select("user_id")
    .eq("user_id", id).in("role", taskRoles).not("activated_at", "is", null).maybeSingle();
  if (error) throw new Error("Unable to verify the task assignee. Please try again.");
  if (!data) throw new Error("Choose an active workspace member who can manage tasks.");
}
