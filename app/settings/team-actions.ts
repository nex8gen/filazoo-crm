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
import { teamInvitationError } from "@/lib/team-invitation-errors";

export type TeamActionState = { error?: string; success?: string; invitationUrl?: string } | undefined;
export async function createTeamInvitation(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const input = z.object({ email: z.string().trim().toLowerCase().email(), displayName: z.string().trim().min(2).max(80), role: workspaceRoleSchema }).safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: "Enter a valid name, email, and workspace role." };
  const token = invitationToken();
  const control = createSupabaseControl(viewer.id);
  // Quota reservation and resending are atomic; a rejected request preserves the old link.
  const { data, error } = await control.rpc("create_workspace_team_invitation", {
    p_actor_id: viewer.id, p_workspace_id: viewer.workspaceId, p_email: input.data.email,
    p_display_name: input.data.displayName, p_role: input.data.role, p_token_hash: invitationHash(token),
  });
  if (error) return { error: teamInvitationError(error) ?? "Unable to create the invitation. Please try again." };
  if (!z.string().uuid().safeParse(data).success) return { error: "Unable to create the invitation. Please try again." };
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
  const { error } = await createSupabaseControl(viewer.id).from("workspace_invitations").update({ revoked_at: new Date().toISOString() })
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
  const { error } = await createSupabaseControl(viewer.id).rpc("leave_crm_workspace", { p_workspace_id: viewer.workspaceId, p_user_id: viewer.id });
  return error ? { error: "Unable to leave this workspace." } : { success: "Workspace access removed." };
}

export async function transferWorkspaceOwnership(_state: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.ownerId !== viewer.id) return { error: "Only the workspace owner can transfer ownership." };
  const target = z.string().uuid().safeParse(formData.get("userId"));
  if (!target.success) return { error: "Choose an active member." };
  const { error } = await createSupabaseControl(viewer.id).rpc("transfer_crm_workspace", { p_workspace_id: viewer.workspaceId, p_actor_id: viewer.id, p_target_id: target.data });
  if (error) return { error: "Unable to transfer ownership. Choose another active member." };
  revalidatePath("/", "layout");
  return { success: "Workspace ownership transferred. You remain an administrator." };
}
