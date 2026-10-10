import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { hasSupabaseAuthConfig, hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthViewer = { id: string; email: string | null };
export type WorkspaceRole = "admin" | "operator" | "viewer";
export type WorkspaceViewer = AuthViewer & { role: WorkspaceRole; displayName: string | null };

export const getViewer = cache(async (): Promise<AuthViewer | null> => {
  if (!hasSupabaseAuthConfig()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return { id: data.claims.sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
});

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

export const getWorkspaceViewer = cache(async (): Promise<WorkspaceViewer | null> => {
  const viewer = await getViewer();
  if (!viewer || !hasSupabaseConfig()) return null;

  const { data, error } = await createSupabaseAdmin()
    .from("workspace_members")
    .select("role,display_name")
    .eq("user_id", viewer.id)
    .maybeSingle();

  if (error || !data) return null;
  return {
    ...viewer,
    role: data.role as WorkspaceRole,
    displayName: data.display_name,
  };
});

export async function requireWorkspaceMember(allowedRoles?: readonly WorkspaceRole[]) {
  const viewer = await requireViewer();
  const member = await getWorkspaceViewer();
  if (!member || member.id !== viewer.id) redirect("/access-denied");
  if (allowedRoles && !allowedRoles.includes(member.role)) redirect("/access-denied");
  return member;
}
