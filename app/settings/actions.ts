"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { createTeamInvitation } from "./team-actions";
import { requireWorkspaceMember } from "@/lib/auth";
import { verifyMailboxConnections } from "@/lib/mailbox-connection";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type SettingsActionState = { error?: string; success?: string; invitationUrl?: string } | undefined;

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
  revalidatePath("/email");
  revalidatePath("/flows");
  return { success: parsed.data.operation === "delete" ? "Mailbox connection deleted. Email history is preserved." : parsed.data.operation === "stop" ? "Mailbox stopped. Sending and syncing are disabled." : "Mailbox resumed." };
}

const profileSchema = z.object({ displayName: z.string().trim().min(2).max(80) });
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

export async function inviteMember(state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.workspaceId === "legacy") return { error: "The workspace upgrade is awaiting database rollout. Existing team access is preserved; new invitations will be available after the migration." };
  return createTeamInvitation(state, formData);
}

export async function updateMemberRole(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = roleSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { error: "Choose a valid workspace role." };
  if (parsed.data.userId === viewer.id || parsed.data.userId === viewer.ownerId) return { error: "Your own role and the workspace owner's role are protected." };
  const { data, error } = await createSupabaseAdmin().from("workspace_members")
    .update({ role: parsed.data.role, auto_assign_leads: parsed.data.role === "bd_manager", updated_at: new Date().toISOString() })
    .eq("user_id", parsed.data.userId).select("user_id").maybeSingle();
  if (error || !data) return { error: "The workspace member could not be updated." };
  revalidatePath("/settings", "layout");
  return { success: "Role updated." };
}

export async function updateMember(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = memberSchema.safeParse({ userId: formData.get("userId"), displayName: formData.get("displayName"), email: formData.get("email"), role: formData.get("role"), autoAssignLeads: formData.get("autoAssignLeads") ?? undefined });
  if (!parsed.success) return { error: "Enter a valid name, email, and workspace role." };
  if (parsed.data.userId === viewer.id || parsed.data.userId === viewer.ownerId) return { error: "Edit your own profile from the Profile tab. The workspace owner's access is protected." };
  const admin = createSupabaseAdmin();
  // Names and roles belong to this workspace. A tenant administrator cannot change a global login identity.
  const { data, error } = await admin.from("workspace_members").update({
    display_name: parsed.data.displayName, role: parsed.data.role,
    auto_assign_leads: parsed.data.role === "bd_manager" && Boolean(parsed.data.autoAssignLeads), updated_at: new Date().toISOString(),
  }).eq("user_id", parsed.data.userId).select("user_id").maybeSingle();
  if (error || !data) return { error: "The workspace member could not be updated." };
  await admin.from("events").insert({ actor_id: viewer.id, type: "workspace_member_updated", data: { target_user_id: parsed.data.userId, summary: parsed.data.displayName + "'s member details were updated." } });
  revalidatePath("/settings", "layout");
  return { success: "Member details updated." };
}

export async function deleteMember(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = memberIdSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return { error: "Choose a valid team member." };
  if (parsed.data.userId === viewer.id) return { error: "You cannot delete your own administrator account." };
  if (parsed.data.userId === viewer.ownerId) return { error: "Transfer ownership before removing the workspace owner." };

  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("remove_workspace_member", { p_user_id: parsed.data.userId, p_actor_id: viewer.id });
  if (error) return { error: "Member deletion could not be confirmed. Please refresh and try again." };

  updateTag(`member-avatar:${parsed.data.userId}`);
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
    isDefault: formData.get("isDefault") ?? undefined,
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
      ? await admin.from("workspace_mailboxes").select("id,email,smtp_password,imap_password").eq("id", parsed.data.mailboxId).eq("type", "workspace").maybeSingle()
      : { data: null, error: null };
    if (existing.error) throw new Error(existing.error.message);
    if (parsed.data.mailboxId && !existing.data) return { error: "Mailbox not found or access denied. Refresh your connections." };
    if (existing.data && existing.data.email !== parsed.data.email) return { error: "Add a separate connection to use a different email address." };
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

    const record = {
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
    };
    const mutation = parsed.data.mailboxId
      ? admin.from("workspace_mailboxes").update(record).eq("id", parsed.data.mailboxId).eq("type", "workspace")
      : admin.from("workspace_mailboxes").insert(record);
    const { data: saved, error: saveError } = await mutation.select("id").maybeSingle();
    if (saveError?.code === "23505") return { error: "This email address is already connected. Manage the existing connection instead." };
    if (saveError || !saved) return { error: "The mailbox could not be saved. Refresh and check your access." };

    revalidatePath("/settings", "layout");
    revalidatePath("/email");
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
    isDefault: formData.get("isDefault") ?? undefined,
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
      ? await admin.from("workspace_mailboxes").select("id,email,smtp_password,imap_password").eq("id", parsed.data.mailboxId).eq("user_id", viewer.id).eq("type", "personal").maybeSingle()
      : { data: null, error: null };
    if (existing.error) throw new Error(existing.error.message);
    if (parsed.data.mailboxId && !existing.data) return { error: "Mailbox not found or access denied. Refresh your connections." };
    if (existing.data && existing.data.email !== parsed.data.email) return { error: "Add a separate connection to use a different email address." };
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

    const record = {
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
    };
    const mutation = parsed.data.mailboxId
      ? admin.from("workspace_mailboxes").update(record).eq("id", parsed.data.mailboxId).eq("type", "personal").eq("user_id", viewer.id)
      : admin.from("workspace_mailboxes").insert(record);
    const { data: saved, error: saveError } = await mutation.select("id").maybeSingle();
    if (saveError?.code === "23505") return { error: "This email address is already connected. Manage the existing connection instead." };
    if (saveError || !saved) return { error: "The mailbox could not be saved. Refresh and check your access." };

    revalidatePath("/settings", "layout");
    revalidatePath("/email");
    return { success: "Personal mailbox connected and saved. SMTP and IMAP authentication succeeded." };
  } catch (error) {
    return { error: error instanceof Error ? `Mailbox connection failed: ${error.message}` : "The personal email could not be saved." };
  }
}
