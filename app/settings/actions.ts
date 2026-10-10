"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { env } from "@/lib/env";
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
