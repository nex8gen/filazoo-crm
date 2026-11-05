"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { invitationHash, invitationToken } from "@/lib/workspace-invitations";
import { workspaceRoleSchema } from "@/lib/workspaces";
import { env } from "@/lib/env";
import { getDefaultWorkspaceMailbox, mailboxHasSmtp } from "@/lib/data/mailboxes";
import { buildInvitationEmail } from "@/lib/auth-invitation";
import { sendMailboxEmail } from "@/lib/mailer";

export type TeamActionState = { error?: string; success?: string; invitationUrl?: string } | undefined;
export async function createTeamInvitation(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const input = z.object({ email: z.string().trim().toLowerCase().email(), displayName: z.string().trim().min(2).max(80), role: workspaceRoleSchema }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: "Enter a valid name, email, and workspace role." };
  const token = invitationToken();
  const control = createSupabaseControl();
  // Resending revokes the previous link; concurrent requests are constrained by the pending index.
  const revoked = await control.from("workspace_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", viewer.workspaceId).eq("email", input.data.email).is("accepted_at", null).is("revoked_at", null);
  if (revoked.error) return { error: "Unable to update existing invitations." };
  const { error } = await control.from("workspace_invitations").insert({ workspace_id: viewer.workspaceId, email: input.data.email,
    display_name: input.data.displayName, role: input.data.role, invited_by: viewer.id, token_hash: invitationHash(token) });
  if (error) return { error: "Unable to create the invitation. Please try again." };
  const invitationUrl = new URL(`/join/${token}`, env.NEXT_PUBLIC_APP_URL).toString();
  let sent = false;
  const mailbox = await getDefaultWorkspaceMailbox();
  if (mailbox && mailboxHasSmtp(mailbox)) {
    try {
      await sendMailboxEmail({ host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email },
        { to: input.data.email, ...buildInvitationEmail(input.data.displayName, invitationUrl, viewer.workspaceName) });
      sent = true;
    } catch { /* The created link remains usable when email delivery is unavailable. */ }
  }
  revalidatePath("/settings/team");
  return { invitationUrl, success: sent ? `Invitation emailed to ${input.data.email}.` : `Invitation created for ${input.data.email}. Share the secure link below. It expires in 7 days.` };
}

export async function revokeTeamInvitation(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const id = z.string().uuid().safeParse(formData.get("invitationId"));
  if (!id.success) return { error: "Choose a valid invitation." };
  const { error } = await createSupabaseControl().from("workspace_invitations").update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data).eq("workspace_id", viewer.workspaceId).is("accepted_at", null);
  if (error) return { error: "Unable to revoke the invitation." };
  revalidatePath("/settings/team");
  return { success: "Invitation revoked." };
}

export async function leaveWorkspace(_state: TeamActionState): Promise<TeamActionState> {
  void _state;
  const viewer = await requireWorkspaceMember();
  if (viewer.ownerId === viewer.id) return { error: "Transfer ownership before leaving this workspace." };
  // The existing transactional removal RPC performs assignment and history cleanup.
  const { error } = await createSupabaseControl().rpc("leave_crm_workspace", { p_workspace_id: viewer.workspaceId, p_user_id: viewer.id });
  return error ? { error: "Unable to leave this workspace." } : { success: "Workspace access removed." };
}

export async function transferWorkspaceOwnership(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.ownerId !== viewer.id) return { error: "Only the workspace owner can transfer ownership." };
  const target = z.string().uuid().safeParse(formData.get("userId"));
  if (!target.success) return { error: "Choose an active member." };
  const { error } = await createSupabaseControl().rpc("transfer_crm_workspace", { p_workspace_id: viewer.workspaceId, p_actor_id: viewer.id, p_target_id: target.data });
  if (error) return { error: "Unable to transfer ownership. Choose another active member." };
  revalidatePath("/settings/team");
  return { success: "Workspace ownership transferred. You remain an administrator." };
}
