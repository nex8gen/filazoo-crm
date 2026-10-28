import { cache } from "react";
import { env, hasSupabaseAuthConfig, hasSupabaseConfig } from "./env.ts";
import { createSupabaseAdmin } from "./supabase/admin.ts";
import { createClient } from "./supabase/server.ts";
import { isAvatarPreset, type AvatarPreset } from "./profile-avatar.ts";
import { readUserPreferences, type UserPreferences } from "./user-preferences.ts";

async function getRedirect() {
  const mod = await import("next/navigation");
  return mod.redirect;
}

async function getConnection() {
  const mod = await import("next/server");
  return mod.connection;
}

export type AuthViewer = { id: string; email: string | null; avatarPath?: string; avatarPreset?: AvatarPreset; preferences?: UserPreferences };
export type WorkspaceRole = "admin" | "operator" | "bd_manager" | "viewer";
export type WorkspaceViewer = AuthViewer & { role: WorkspaceRole; displayName: string | null };

type MemberRow = { role: string | null; display_name: string | null; activated_at: string | null };
type SessionRow = MemberRow & { id: string; email: string | null; user_metadata: Record<string, unknown> | null };
type AuthSnapshot = { viewer: AuthViewer; member: WorkspaceViewer | null };
const workspaceRoles = new Set<string>(["admin", "operator", "bd_manager", "viewer"]);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function toViewer(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }): AuthViewer {
  const metadata = user.user_metadata;
  return {
    id: user.id,
    email: user.email ?? null,
    preferences: readUserPreferences(metadata?.crm_preferences),
    avatarPath: typeof metadata?.avatar_path === "string" ? metadata.avatar_path : undefined,
    avatarPreset: isAvatarPreset(metadata?.avatar_preset) ? metadata.avatar_preset : "male",
  };
}

function toMember(viewer: AuthViewer, row: MemberRow | null): WorkspaceViewer | null {
  if (!row?.activated_at || !row.role || !workspaceRoles.has(row.role)) return null;
  return { ...viewer, role: row.role as WorkspaceRole, displayName: row.display_name };
}

// Only for environments where the additive database migration is not installed.
// Authentication errors or a revoked/blocked session never take this fallback.
async function legacySnapshot(supabase: Awaited<ReturnType<typeof createClient>>): Promise<AuthSnapshot | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const viewer = toViewer(data.user);
  if (!hasSupabaseConfig()) return { viewer, member: null };
  const member = await createSupabaseAdmin().from("workspace_members")
    .select("role,display_name,activated_at").eq("user_id", viewer.id).maybeSingle();
  if (member.error) throw new Error(`Workspace membership lookup failed: ${member.error.message}`);
  return { viewer, member: toMember(viewer, member.data) };
}

const getAuthSnapshot = cache(async (): Promise<AuthSnapshot | null> => {
  if (!hasSupabaseAuthConfig()) return null;
  // Supabase validates JWT expiry against the current time. Explicitly defer
  // that work to the incoming request when Cache Components prerenders a shell.
  const connection = await getConnection();
  if (connection) await connection();
  const supabase = await createClient();
  if (!hasSupabaseConfig()) return legacySnapshot(supabase);
  // The SDK verifies signature and expiry using cached public signing keys.
  // Never trust decoded cookies, JWT user_metadata, or client-provided roles.
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || !uuid.test(claims.sub) || typeof claims.session_id !== "string" || !uuid.test(claims.session_id)) return null;
  const audience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  if (audience !== "authenticated" || claims.role !== "authenticated" || claims.iss !== `${env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/auth/v1`) return null;
  // One fresh database snapshot checks session ownership/revocation, banned or
  // deleted users, profile metadata, and current membership. It is never put in
  // a shared cache; React.cache only deduplicates a single Server Component render.
  const result = await createSupabaseAdmin().rpc("read_crm_session", {
    p_user_id: claims.sub, p_session_id: claims.session_id,
  }).maybeSingle();
  if (result.error) {
    if (result.error.code === "PGRST202" || result.error.code === "42883") return legacySnapshot(supabase);
    throw new Error(`Workspace session lookup failed: ${result.error.message}`);
  }
  const row = result.data as SessionRow | null;
  if (!row || row.id !== claims.sub) return null;
  const viewer = toViewer(row);
  return { viewer, member: toMember(viewer, row) };
});

export const getViewer = cache(async (): Promise<AuthViewer | null> => (await getAuthSnapshot())?.viewer ?? null);

export async function requireViewer(): Promise<AuthViewer> {
  const viewer = await getViewer();
  if (!viewer) {
    const redirect = await getRedirect();
    redirect("/login");
    throw new Error("Authentication required.");
  }
  return viewer;
}

function assertWorkspaceConfig() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase server authentication is not configured. Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.");
  }
}

export const getWorkspaceViewer = cache(async (): Promise<WorkspaceViewer | null> => {
  const snapshot = await getAuthSnapshot();
  if (!snapshot) return null;
  assertWorkspaceConfig();
  return snapshot.member;
});

export async function requireWorkspaceMember(allowedRoles?: readonly WorkspaceRole[]): Promise<WorkspaceViewer> {
  const snapshot = await getAuthSnapshot();
  if (!snapshot) {
    const redirect = await getRedirect();
    redirect("/login");
    throw new Error("Authentication required.");
  }
  assertWorkspaceConfig();
  const member = snapshot.member;
  if (!member) {
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
