import { cache } from "react";
import { hasSupabaseAuthConfig, hasSupabaseConfig } from "./env.ts";
import { createSupabaseAdmin } from "./supabase/admin.ts";
import { createClient } from "./supabase/server.ts";
import { isAvatarPreset, type AvatarPreset } from "./profile-avatar.ts";

async function getRedirect() {
  const mod = await import("next/navigation");
  return mod.redirect;
}

async function getConnection() {
  const mod = await import("next/server");
  return mod.connection;
}

export type AuthViewer = { id: string; email: string | null; avatarPath?: string; avatarPreset?: AvatarPreset };
export type WorkspaceRole = "admin" | "operator" | "bd_manager" | "viewer";
export type WorkspaceViewer = AuthViewer & { role: WorkspaceRole; displayName: string | null };

export const getViewer = cache(async (): Promise<AuthViewer | null> => {
  if (!hasSupabaseAuthConfig()) return null;
  // Supabase validates JWT expiry against the current time. Explicitly defer
  // that work to the incoming request when Cache Components prerenders a shell.
  const connection = await getConnection();
  if (connection) await connection();
  const supabase = await createClient();
  // Profile metadata can change without the access token being renewed (and
  // from another session). Read the current Auth user rather than JWT claims.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const metadata = data.user.user_metadata;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    avatarPath: typeof metadata?.avatar_path === "string" ? metadata.avatar_path : undefined,
    avatarPreset: isAvatarPreset(metadata?.avatar_preset) ? metadata.avatar_preset : "male",
  };
});

export async function requireViewer(): Promise<AuthViewer> {
  const viewer = await getViewer();
  if (!viewer) {
    const redirect = await getRedirect();
    redirect("/login");
    throw new Error("Authentication required.");
  }
  return viewer;
}

export const getWorkspaceViewer = cache(async (): Promise<WorkspaceViewer | null> => {
  const viewer = await getViewer();
  if (!viewer || !hasSupabaseConfig()) return null;

  const { data, error } = await createSupabaseAdmin()
    .from("workspace_members")
    .select("role,display_name,activated_at")
    .eq("user_id", viewer.id)
    .maybeSingle();

  if (error || !data?.activated_at) return null;
  return {
    ...viewer,
    role: data.role as WorkspaceRole,
    displayName: data.display_name,
  };
});

export async function requireWorkspaceMember(allowedRoles?: readonly WorkspaceRole[]): Promise<WorkspaceViewer> {
  const viewer = await requireViewer();
  const member = await getWorkspaceViewer();
  if (!member || member.id !== viewer.id) {
    const redirect = await getRedirect();
    redirect("/access-denied");
    throw new Error("Access denied.");
  }
  if (allowedRoles && !allowedRoles.includes(member.role)) {
    const redirect = await getRedirect();
    redirect("/access-denied");
    throw new Error("Access denied.");
  }
  return member;
}
