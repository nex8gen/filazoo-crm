"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { env } from "@/lib/env";
import { verifyMailboxConnections } from "@/lib/mailbox-connection";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type SettingsActionState = { error?: string; success?: string } | undefined;

const profileSchema = z.object({ displayName: z.string().trim().min(2).max(80) });
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(2).max(80),
  role: z.enum(["admin", "operator", "viewer"]),
});
const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "operator", "viewer"]),
});
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
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const parsed = profileSchema.safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) return { error: "Enter a display name between 2 and 80 characters." };

  const admin = createSupabaseAdmin();
  const [{ error: memberError }, { error: authError }] = await Promise.all([
    admin.from("workspace_members").update({ display_name: parsed.data.displayName, updated_at: new Date().toISOString() }).eq("user_id", viewer.id),
    admin.auth.admin.updateUserById(viewer.id, { user_metadata: { display_name: parsed.data.displayName } }),
  ]);
  if (memberError || authError) return { error: "The profile could not be updated." };
  revalidatePath("/settings");
  return { success: "Profile updated." };
}

export async function inviteMember(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  await requireWorkspaceMember(["admin"]);
  const parsed = inviteSchema.safeParse({ email: formData.get("email"), displayName: formData.get("displayName"), role: formData.get("role") });
  if (!parsed.success) return { error: "Enter a valid name, email, and workspace role." };

  const admin = createSupabaseAdmin();
  const redirectTo = new URL("/update-password", env.NEXT_PUBLIC_APP_URL).toString();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, { data: { display_name: parsed.data.displayName }, redirectTo });
  if (error || !data.user) return { error: error?.message || "The invitation could not be created." };

  const [{ error: metadataError }, { error: memberError }] = await Promise.all([
    admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role: parsed.data.role } }),
    admin.from("workspace_members").upsert({ user_id: data.user.id, display_name: parsed.data.displayName, role: parsed.data.role, updated_at: new Date().toISOString() }, { onConflict: "user_id" }),
  ]);
  if (metadataError || memberError) return { error: "The user was invited, but workspace access could not be assigned. Review the user in Supabase." };

  revalidatePath("/settings");
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
    admin.from("workspace_members").update({ role: parsed.data.role, updated_at: new Date().toISOString() }).eq("user_id", parsed.data.userId),
    admin.auth.admin.updateUserById(parsed.data.userId, { app_metadata: { ...target.user.app_metadata, role: parsed.data.role } }),
  ]);
  if (memberError || metadataError) return { error: "The workspace role could not be updated." };

  revalidatePath("/settings");
  return { success: "Role updated." };
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

    revalidatePath("/settings");
    revalidatePath("/emails");
    return { success: "Workspace mailbox connected and saved. SMTP and IMAP authentication succeeded." };
  } catch (error) {
    return { error: error instanceof Error ? `Mailbox connection failed: ${error.message}` : "The workspace email could not be saved." };
  }
}

export async function savePersonalMailbox(_state: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
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

    revalidatePath("/settings");
    revalidatePath("/emails");
    return { success: "Personal mailbox connected and saved. SMTP and IMAP authentication succeeded." };
  } catch (error) {
    return { error: error instanceof Error ? `Mailbox connection failed: ${error.message}` : "The personal email could not be saved." };
  }
}
