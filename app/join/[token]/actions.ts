"use server";

import { cookies } from "next/headers";
import { requireViewer } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { invitationHash, validInvitationToken } from "@/lib/workspace-invitations";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema } from "@/lib/workspaces";

export async function joinWorkspace(_state: { error?: string; success?: string } | undefined, formData: FormData) {
  const viewer = await requireViewer();
  const token = String(formData.get("token") || "");
  if (!validInvitationToken(token)) return { error: "This invitation is invalid." };
  const { data, error } = await createSupabaseControl().rpc("accept_workspace_invitation", { p_user_id: viewer.id, p_token_hash: invitationHash(token) });
  if (error || !workspaceIdSchema.safeParse(data).success) return { error: "This invitation has expired, was revoked, or belongs to a different email address. Sign in with the invited email or ask your administrator for a new link." };
  (await cookies()).set(workspaceCookie, data, workspaceCookieOptions());
  return { success: "Workspace joined." };
}
