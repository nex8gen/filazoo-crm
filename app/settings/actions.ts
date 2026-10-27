"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildInvitationConfirmationUrl, buildInvitationEmail } from "@/lib/auth-invitation";
import { requireWorkspaceMember } from "@/lib/auth";
import { getDefaultWorkspaceMailbox, mailboxHasSmtp } from "@/lib/data/mailboxes";
import { listAllAuthUsers } from "@/lib/data/members";
import { env } from "@/lib/env";
import { sendMailboxEmail } from "@/lib/mailer";
import { verifyMailboxConnections } from "@/lib/mailbox-connection";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type SettingsActionState = { error?: string; success?: string } | undefined;

export async function manageMailbox(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = z.object({ mailboxId: z.string().uuid(), operation: z.enum(["stop", "resume", "delete"]) }).safeParse({
    mailboxId: formData.get("mailboxId"), operation: formData.get("operation"),
  });
  if (!parsed.success) return { error: "Choose a valid mailbox and action." };

  const admin = createSupabaseAdmin();
  // Scope the mutation itself: personal owners or workspace administrators only.
  const query = parsed.data.operation === "delete"
    ? admin.from("workspace_mailboxes").delete()
    : admin.from("workspace_mailboxes").update({ is_active: parsed.data.operation === "resume", updated_at: new Date().toISOString() });
  let scoped = query.eq("id", parsed.data.mailboxId);
  if (viewer.role !== "admin") scoped = scoped.eq("type", "personal").eq("user_id", viewer.id);
  const { data, error } = await scoped.select("id").maybeSingle();
  if (error) return { error: "The mailbox could not be changed. Please try again." };
  if (!data) return { error: "Mailbox not found or you do not have permission to manage it." };

  revalidatePath("/settings", "layout");
  revalidatePath("/emails");
  revalidatePath("/flows");
  return { success: parsed.data.operation === "delete" ? "Mailbox connection deleted. Email history is preserved." : parsed.data.operation === "stop" ? "Mailbox stopped. Sending and syncing are disabled." : "Mailbox resumed." };
}

const profileSchema = z.object({ displayName: z.string().trim().min(2).max(80) });
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(2).max(80),
  role: z.enum(["admin", "operator", "bd_manager", "viewer"]),
});
const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "operator", "bd_manager", "viewer"]),
});
const memberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["admin", "operator", "bd_manager", "viewer"]),
  autoAssignLeads: z.enum(["on", "true"]).optional(),
});
const memberIdSchema = z.object({ userId: z.string().uuid() });
const mailboxSchema = z.object({
  mailboxId: z.string().uuid().optional().or(z.literal("")),
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().max(80).default(""),
  provider: z.enum(["smtp", "google", "microsoft", "other"]).default("smtp"),
  notes: z.string().trim().max(240).default(""),
  isDefault: z.enum(["on", "true", "false", ""]).optional(),
  smtpHost: z.string().trim().max(255).optional().or(z.literal("")),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional().or(z.literal("")),
  smtpUsername: z.string().trim().max(255).optional().or(z.literal("")),
  smtpPassword: z.string().trim().max(255).optional().or(z.literal("")),
  imapHost: z.string().trim().max(255).optional().or(z.literal("")),
  imapPort: z.coerce.number().int().min(1).max(65535).optional().or(z.literal("")),
  imapUsername: z.string().trim().max(255).optional().or(z.literal("")),
  imapPassword: z.string().trim().max(255).optional().or(z.literal("")),
});

export async function updateProfile(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = profileSchema.safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) return { error: "Enter a display name between 2 and 80 characters." };

  const admin = createSupabaseAdmin();
  const [{ error: memberError }, { error: authError }] = await Promise.all([
    admin.from("workspace_members").update({ display_name: parsed.data.displayName, updated_at: new Date().toISOString() }).eq("user_id", viewer.id),
    admin.auth.admin.updateUserById(viewer.id, { user_metadata: { display_name: parsed.data.displayName } }),
  ]);
  if (memberError || authError) return { error: "The profile could not be updated." };
  revalidatePath("/", "layout");
  return { success: "Profile updated." };
}

export async function inviteMember(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  await requireWorkspaceMember(["admin"]);
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), displayName: formData.get("displayName"), role: formData.get("role") });
  if (!parsed.success) return { error: "Enter a valid name, email, and workspace role." };

  const mailbox = await getDefaultWorkspaceMailbox();
  if (!mailbox || !mailboxHasSmtp(mailbox)) return { error: "Connect a default workspace mailbox before sending team invitations." };

  const admin = createSupabaseAdmin();
  let authUsers;
  try {
    authUsers = await listAllAuthUsers();
  } catch {
    return { error: "The existing team accounts could not be checked. Try again shortly." };
  }

  const existingUser = authUsers.find((user) => user.email?.toLowerCase() === parsed.data.email);
  let existingMembership: { user_id: string; activated_at: string | null } | null = null;
  if (existingUser) {
    const { data, error: membershipLookupError } = await admin.from("workspace_members").select("user_id,activated_at").eq("user_id", existingUser.id).maybeSingle();
    if (membershipLookupError) return { error: "The existing workspace access could not be checked." };
    existingMembership = data;
    if (existingMembership?.activated_at) return { error: "This email already belongs to an active workspace member." };
  }

  const { data, error } = existingUser
    ? await admin.auth.admin.generateLink({ type: "recovery", email: parsed.data.email })
    : await admin.auth.admin.generateLink({
        type: "invite",
        email: parsed.data.email,
        options: { data: { display_name: parsed.data.displayName } },
      });
  if (error || !data.user || !data.properties?.hashed_token) return { error: error?.message || "The invitation could not be created." };

  const [{ error: metadataError }, { error: memberError }] = await Promise.all([
    admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: parsed.data.role } }),
    admin.from("workspace_members").upsert({ user_id: data.user.id, display_name: parsed.data.displayName, role: parsed.data.role, auto_assign_leads: parsed.data.role === "bd_manager", activated_at: null, updated_at: new Date().toISOString() }, { onConflict: "user_id" }),
  ]);
  if (metadataError || memberError) return { error: "The user was invited, but workspace access could not be assigned. Review the user in Supabase." };

  let confirmationUrl: string;
  try {
    confirmationUrl = buildInvitationConfirmationUrl(env.NEXT_PUBLIC_APP_URL, data.properties.hashed_token, data.properties.verification_type);
  } catch (linkError) {
    return { error: linkError instanceof Error ? linkError.message : "The invitation link could not be created." };
  }
  const invitation = buildInvitationEmail(parsed.data.displayName, confirmationUrl);
  try {
    await sendMailboxEmail(
      { host: mailbox.smtpHost, port: mailbox.smtpPort, user: mailbox.smtpUsername, pass: mailbox.smtpPassword, from: mailbox.email },
      { to: parsed.data.email, ...invitation },
    );
  } catch {
    return { error: "The account was created, but the invitation email could not be sent. Check the workspace SMTP connection before trying again." };
  }

  revalidatePath("/settings", "layout");
  return { success: `Invitation sent to ${parsed.data.email}.` };
}

export async function updateMemberRole(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = roleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { error: "Choose a valid workspace role." };
  if (parsed.data.userId === viewer.id) return { error: "You cannot change your own administrator role." };

  const admin = createSupabaseAdmin();
  const { data: target, error: targetError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (targetError || !target.user) return { error: "The team member could not be found." };

  const [{ error: memberError }, { error: metadataError }] = await Promise.all([
    admin.from("workspace_members").update({ role: parsed.data.role, auto_assign_leads: parsed.data.role === "bd_manager", updated_at: new Date().toISOString() }).eq("user_id", parsed.data.userId),
    admin.auth.admin.updateUserById(parsed.data.userId, { app_metadata: { ...target.user.app_metadata, role: parsed.data.role } }),
  ]);
  if (memberError || metadataError) return { error: "The workspace role could not be updated." };

  revalidatePath("/settings", "layout");
  return { success: "Role updated." };
}

export async function updateMember(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = memberSchema.safeParse({ userId: formData.get("userId"), displayName: formData.get("displayName"), email: formData.get("email"), role: formData.get("role"), autoAssignLeads: formData.get("autoAssignLeads") });
  if (!parsed.success) return { error: "Enter a valid name, email, and workspace role." };
  if (parsed.data.userId === viewer.id) return { error: "Edit your own name from the Account tab. Your administrator role is protected." };

  const admin = createSupabaseAdmin();
  const [{ data: target, error: targetError }, { data: membership, error: membershipError }] = await Promise.all([
    admin.auth.admin.getUserById(parsed.data.userId),
    admin.from("workspace_members").select("role,display_name,auto_assign_leads").eq("user_id", parsed.data.userId).maybeSingle(),
  ]);
  if (targetError || !target.user || membershipError || !membership) return { error: "The team member could not be found." };

  const autoAssignLeads = parsed.data.role === "bd_manager" && Boolean(parsed.data.autoAssignLeads);
  const { error: authError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
    email: parsed.data.email,
    user_metadata: { ...target.user.user_metadata, display_name: parsed.data.displayName },
    app_metadata: { ...target.user.app_metadata, role: parsed.data.role },
  });
  if (authError) return { error: authError.message || "The authentication account could not be updated." };

  const { error: updateError } = await admin.from("workspace_members").update({ display_name: parsed.data.displayName, role: parsed.data.role, auto_assign_leads: autoAssignLeads, updated_at: new Date().toISOString() }).eq("user_id", parsed.data.userId);
  if (updateError) {
    await admin.auth.admin.updateUserById(parsed.data.userId, { email: target.user.email, user_metadata: target.user.user_metadata, app_metadata: target.user.app_metadata });
    return { error: "The workspace member could not be updated." };
  }

  await admin.from("events").insert({ actor_id: viewer.id, type: "workspace_member_updated", data: { target_user_id: parsed.data.userId, summary: `${parsed.data.displayName}'s member details were updated.` } });
  revalidatePath("/settings", "layout");
  return { success: "Member details updated." };
}

export async function deleteMember(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = memberIdSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return { error: "Choose a valid team member." };
  if (parsed.data.userId === viewer.id) return { error: "You cannot delete your own administrator account." };

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("remove_workspace_member", { p_user_id: parsed.data.userId, p_actor_id: viewer.id });
  if (error) return { error: "Member deletion could not be confirmed. Please refresh and try again." };

  revalidatePath("/", "layout");
  const reassigned = Number(data?.reassigned ?? 0);
  const unassigned = Number(data?.unassigned ?? 0);
  return { success: `Member deleted and workspace access removed.${reassigned ? ` ${reassigned} customer assignment${reassigned === 1 ? "" : "s"} redistributed to remaining BD Sales Managers.` : ""}${unassigned ? ` ${unassigned} customer assignment${unassigned === 1 ? " remains" : "s remain"} unassigned because no active BD Sales Manager has automatic assignment enabled.` : ""}` };
}

export async function saveWorkspaceMailbox(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  await requireWorkspaceMember(["admin"]);
  const parsed = mailboxSchema.safeParse({
    mailboxId: formData.get("mailboxId"),
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    provider: formData.get("provider") ?? "smtp",
    notes: formData.get("notes"),
    isDefault: formData.get("isDefault"),
    smtpHost: formData.get("smtpHost"),
    smtpPort: formData.get("smtpPort"),
    smtpUsername: formData.get("smtpUsername"),
    smtpPassword: formData.get("smtpPassword"),
    imapHost: formData.get("imapHost"),
    imapPort: formData.get("imapPort"),
    imapUsername: formData.get("imapUsername"),
    imapPassword: formData.get("imapPassword"),
  });

  if (!parsed.success) return { error: "Enter a valid workspace email address and mailbox settings." };

  const admin = createSupabaseAdmin();
  const email = parsed.data.email;
  const isDefault = parsed.data.isDefault === "on" || parsed.data.isDefault === "true";

  try {
    const existing = parsed.data.mailboxId
      ? await admin.from("workspace_mailboxes").select("id,smtp_password,imap_password").eq("id", parsed.data.mailboxId).eq("type", "workspace").maybeSingle()
      : { data: null, error: null };
    if (existing.error) throw new Error(existing.error.message);
    const smtpPassword = parsed.data.smtpPassword || existing.data?.smtp_password || "";
    const imapPassword = parsed.data.imapPassword || existing.data?.imap_password || "";
    if (!parsed.data.smtpHost || !parsed.data.smtpUsername || !smtpPassword || !parsed.data.imapHost || !parsed.data.imapUsername || !imapPassword) {
      return { error: "Complete all SMTP and IMAP fields before connecting this mailbox." };
    }
    await verifyMailboxConnections({
      email,
      smtpHost: parsed.data.smtpHost,
      smtpPort: Number(parsed.data.smtpPort || 587),
      smtpUsername: parsed.data.smtpUsername,
      smtpPassword,
      imapHost: parsed.data.imapHost,
      imapPort: Number(parsed.data.imapPort || 993),
      imapUsername: parsed.data.imapUsername,
      imapPassword,
    });

    if (isDefault) {
      const { error: resetError } = await admin.from("workspace_mailboxes")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("type", "workspace");
      if (resetError) throw new Error(resetError.message);
    }

    const { error: upsertError } = await admin.from("workspace_mailboxes").upsert({
      ...(parsed.data.mailboxId ? { id: parsed.data.mailboxId } : {}),
      email,
      user_id: null,
      type: "workspace",
      display_name: parsed.data.displayName || "Workspace mailbox",
      is_default: isDefault,
      provider: parsed.data.provider,
      notes: parsed.data.notes || "Primary workspace mailbox",
      smtp_host: parsed.data.smtpHost || null,
      smtp_port: parsed.data.smtpPort || null,
      smtp_username: parsed.data.smtpUsername || null,
      smtp_password: smtpPassword,
      imap_host: parsed.data.imapHost || null,
      imap_port: parsed.data.imapPort || null,
      imap_username: parsed.data.imapUsername || null,
      imap_password: imapPassword,
      updated_at: new Date().toISOString(),
    }, { onConflict: parsed.data.mailboxId ? "id" : "email" });
    if (upsertError) throw new Error(upsertError.message);

    revalidatePath("/settings", "layout");
    revalidatePath("/emails");
    return { success: "Workspace mailbox connected and saved. SMTP and IMAP authentication succeeded." };
  } catch (error) {
    return { error: error instanceof Error ? `Mailbox connection failed: ${error.message}` : "The workspace email could not be saved." };
  }
}

export async function savePersonalMailbox(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = mailboxSchema.safeParse({
    mailboxId: formData.get("mailboxId"),
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    provider: formData.get("provider") ?? "smtp",
    notes: formData.get("notes"),
    isDefault: formData.get("isDefault"),
    smtpHost: formData.get("smtpHost"),
    smtpPort: formData.get("smtpPort"),
    smtpUsername: formData.get("smtpUsername"),
    smtpPassword: formData.get("smtpPassword"),
    imapHost: formData.get("imapHost"),
    imapPort: formData.get("imapPort"),
    imapUsername: formData.get("imapUsername"),
    imapPassword: formData.get("imapPassword"),
  });

  if (!parsed.success) return { error: "Enter a valid personal email address." };

  const admin = createSupabaseAdmin();
  const isDefault = parsed.data.isDefault === "on" || parsed.data.isDefault === "true";

  try {
    const existing = parsed.data.mailboxId
      ? await admin.from("workspace_mailboxes").select("id,smtp_password,imap_password").eq("id", parsed.data.mailboxId).eq("user_id", viewer.id).eq("type", "personal").maybeSingle()
      : { data: null, error: null };
    if (existing.error) throw new Error(existing.error.message);
    const smtpPassword = parsed.data.smtpPassword || existing.data?.smtp_password || "";
    const imapPassword = parsed.data.imapPassword || existing.data?.imap_password || "";
    if (!parsed.data.smtpHost || !parsed.data.smtpUsername || !smtpPassword || !parsed.data.imapHost || !parsed.data.imapUsername || !imapPassword) {
      return { error: "Complete all SMTP and IMAP fields before connecting this mailbox." };
    }
    await verifyMailboxConnections({
      email: parsed.data.email,
      smtpHost: parsed.data.smtpHost,
      smtpPort: Number(parsed.data.smtpPort || 587),
      smtpUsername: parsed.data.smtpUsername,
      smtpPassword,
      imapHost: parsed.data.imapHost,
      imapPort: Number(parsed.data.imapPort || 993),
      imapUsername: parsed.data.imapUsername,
      imapPassword,
    });

    if (isDefault) {
      const { error: resetError } = await admin
        .from("workspace_mailboxes")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("user_id", viewer.id)
        .eq("type", "personal");
      if (resetError) throw new Error(resetError.message);
    }

    const { error: upsertError } = await admin.from("workspace_mailboxes").upsert({
      ...(parsed.data.mailboxId ? { id: parsed.data.mailboxId } : {}),
      email: parsed.data.email,
      user_id: viewer.id,
      type: "personal",
      display_name: parsed.data.displayName || viewer.displayName || "Personal mailbox",
      is_default: isDefault,
      provider: parsed.data.provider,
      notes: parsed.data.notes || "Personal manager mailbox",
      smtp_host: parsed.data.smtpHost || null,
      smtp_port: parsed.data.smtpPort || null,
      smtp_username: parsed.data.smtpUsername || null,
      smtp_password: smtpPassword,
      imap_host: parsed.data.imapHost || null,
      imap_port: parsed.data.imapPort || null,
      imap_username: parsed.data.imapUsername || null,
      imap_password: imapPassword,
      updated_at: new Date().toISOString(),
    }, { onConflict: parsed.data.mailboxId ? "id" : "email" });
    if (upsertError) throw new Error(upsertError.message);

    revalidatePath("/settings", "layout");
    revalidatePath("/emails");
    return { success: "Personal mailbox connected and saved. SMTP and IMAP authentication succeeded." };
  } catch (error) {
    return { error: error instanceof Error ? `Mailbox connection failed: ${error.message}` : "The personal email could not be saved." };
  }
}
