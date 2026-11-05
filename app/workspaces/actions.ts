"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireViewer, requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema, workspaceSlug } from "@/lib/workspaces";

export type WorkspaceActionState = { error?: string; success?: string } | undefined;

export async function createWorkspace(_state: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  const viewer = await requireViewer();
  const name = workspaceNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  const { data, error } = await createSupabaseControl().rpc("create_crm_workspace", {
    p_user_id: viewer.id, p_name: name.data, p_slug: `${workspaceSlug(name.data)}-${randomUUID().slice(0, 8)}`,
  });
  if (error?.code === "PGRST202" || error?.code === "42883") return { error: "Workspace creation is awaiting the database upgrade. Your account is ready." };
  if (error || !workspaceIdSchema.safeParse(data).success) return { error: "Unable to create your workspace. Verify your email and try again. Each account can own up to 10 workspaces." };
  (await cookies()).set(workspaceCookie, data, workspaceCookieOptions());
  redirect("/workspaces/setup");
}

export async function switchWorkspace(_state: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  const viewer = await requireViewer();
  const id = workspaceIdSchema.safeParse(formData.get("workspaceId"));
  if (formData.get("workspaceId") === "legacy" && (await requireWorkspaceMember()).workspaceId === "legacy") return { success: "Workspace selected." };
  if (!id.success) return { error: "Choose a valid workspace." };
  const { data, error } = await createSupabaseControl().from("workspace_members").select("workspace_id")
    .eq("workspace_id", id.data).eq("user_id", viewer.id).not("activated_at", "is", null).maybeSingle();
  if (error || !data) return { error: "You no longer have access to this workspace." };
  (await cookies()).set(workspaceCookie, id.data, workspaceCookieOptions());
  return { success: "Workspace switched." };
}

export async function renameWorkspace(_state: WorkspaceActionState, formData: FormData): Promise<WorkspaceActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const name = workspaceNameSchema.safeParse(formData.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  const { error } = await createSupabaseControl().from("workspaces").update({ name: name.data, updated_at: new Date().toISOString() }).eq("id", viewer.workspaceId);
  return error ? { error: "Unable to update the workspace." } : { success: "Workspace name updated." };
}
