import { cache } from "react";
import { env, hasSupabaseAuthConfig, hasSupabaseConfig } from "./env.ts";
import { createSupabaseControl } from "./supabase/control.ts";
import { workspaceCookie, workspaceIdSchema, workspaceNameSchema } from "./workspaces.ts";
import { createClient } from "./supabase/server.ts";
import { isTransientAuthError } from "./supabase/auth-error.ts";
import { isAvatarPreset, type AvatarPreset } from "./profile-avatar.ts";
import { readUserPreferences, type UserPreferences } from "./user-preferences.ts";
import { readTableColumnPreferences, type TableColumnPreferences } from "./table-column-preferences.ts";

async function getRedirect() {
  const mod = await import("next/navigation");
  return mod.redirect;
}

async function getConnection() {
  const mod = await import("next/server");
  return mod.connection;
}

export type AuthViewer = { id: string; email: string | null; companyName?: string; avatarPath?: string; avatarPreset?: AvatarPreset; preferences?: UserPreferences; tableColumns?: TableColumnPreferences };
export type WorkspaceRole = "admin" | "operator" | "bd_manager" | "viewer";
export type WorkspaceViewer = AuthViewer & { role: WorkspaceRole; displayName: string | null; workspaceId: string; workspaceName: string; ownerId: string; subscriptionActive?: boolean };

type MemberRow = { role: string | null; display_name: string | null; activated_at: string | null; workspace_id: string | null; workspace_name: string | null; owner_id: string | null; subscription_active?: boolean };
type SessionRow = MemberRow & { id: string; email: string | null; user_metadata: Record<string, unknown> | null; mfa_required: boolean };
type AuthSnapshot = { viewer: AuthViewer; member: WorkspaceViewer | null; requiresMfa: boolean };
const workspaceRoles = new Set<string>(["admin", "operator", "bd_manager", "viewer"]);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function toViewer(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }): AuthViewer {
  const metadata = user.user_metadata;
  // Company metadata is a naming preference, never an authorization claim.
  const companyName = workspaceNameSchema.safeParse(metadata?.company_name);
  return {
    id: user.id,
    email: user.email ?? null,
    companyName: companyName.success ? companyName.data : undefined,
    preferences: readUserPreferences(metadata?.crm_preferences),
    tableColumns: readTableColumnPreferences(metadata),
    avatarPath: typeof metadata?.avatar_path === "string" ? metadata.avatar_path : undefined,
    avatarPreset: isAvatarPreset(metadata?.avatar_preset) ? metadata.avatar_preset : "male",
  };
}

function toMember(viewer: AuthViewer, row: MemberRow | null): WorkspaceViewer | null {
  if (!row?.activated_at || !row.role || !workspaceRoles.has(row.role) || !row.workspace_id || !row.owner_id) return null;
  return { ...viewer, role: row.role as WorkspaceRole, displayName: row.display_name, workspaceId: row.workspace_id, workspaceName: row.workspace_name || "Workspace", ownerId: row.owner_id, subscriptionActive: row.subscription_active === true };
}

const getAuthSnapshot = cache(async (): Promise<AuthSnapshot | null> => {
  if (!hasSupabaseAuthConfig()) return null;
  // Supabase validates JWT expiry against the current time. Explicitly defer
  // that work to the incoming request when Cache Components prerenders a shell.
  const connection = await getConnection();
  if (connection) await connection();
  const supabase = await createClient();
  assertWorkspaceConfig();
  // The SDK verifies signature and expiry using cached public signing keys.
  // Never trust decoded cookies, JWT user_metadata, or client-provided roles.
  const { data, error } = await supabase.auth.getClaims();
  if (isTransientAuthError(error)) throw new Error("Unable to verify your workspace session. Please retry.", { cause: error });
  const claims = data?.claims;
  if (error || !claims || !uuid.test(claims.sub) || typeof claims.session_id !== "string" || !uuid.test(claims.session_id)) return null;
  const audience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  if (audience !== "authenticated" || claims.role !== "authenticated" || claims.iss !== `${env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/auth/v1`) return null;
  // One fresh database snapshot checks session ownership/revocation, banned or
  // deleted users, profile metadata, and current membership. It is never put in
  // a shared cache; React.cache only deduplicates a single Server Component render.
  const { cookies } = await import("next/headers");
  const selected = workspaceIdSchema.safeParse((await cookies()).get(workspaceCookie)?.value);
  const result = await createSupabaseControl().rpc("read_secure_workspace_session", {
    p_user_id: claims.sub, p_session_id: claims.session_id, p_workspace_id: selected.success ? selected.data : null,
  }).maybeSingle();
  if (result.error) {
    // Never fall back to an older reader that cannot enforce two-step verification.
    throw new Error(`Workspace session lookup failed: ${result.error.message}`);
  }
  const row = result.data as SessionRow | null;
  if (!row || row.id !== claims.sub) return null;
  if (typeof row.mfa_required !== "boolean") throw new Error("Workspace session lookup failed: security state is missing.");
  const viewer = toViewer(row);
  return { viewer, member: toMember(viewer, row), requiresMfa: row.mfa_required && claims.aal !== "aal2" };
});

export const isMfaPending = cache(async () => (await getAuthSnapshot())?.requiresMfa === true);
export const getViewer = cache(async (): Promise<AuthViewer | null> => {
  const snapshot = await getAuthSnapshot();
  return snapshot && !snapshot.requiresMfa ? snapshot.viewer : null;
});

export async function requireViewer(): Promise<AuthViewer> {
  const snapshot = await getAuthSnapshot();
  if (snapshot?.requiresMfa) (await getRedirect())("/auth/mfa");
  if (!snapshot) {
    const redirect = await getRedirect();
    redirect("/login");
    throw new Error("Authentication required.");
  }
  return snapshot.viewer;
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
  return snapshot.requiresMfa ? null : snapshot.member;
});

export async function requireWorkspaceMember(allowedRoles?: readonly WorkspaceRole[]): Promise<WorkspaceViewer> {
  const snapshot = await getAuthSnapshot();
  if (snapshot?.requiresMfa) (await getRedirect())("/auth/mfa");
  if (!snapshot) {
    const redirect = await getRedirect();
    redirect("/login");
    throw new Error("Authentication required.");
  }
  assertWorkspaceConfig();
  const member = snapshot.member;
  if (!member) {
    const redirect = await getRedirect();
    redirect("/subscribe");
    throw new Error("Access denied.");
  }
  if (allowedRoles && !allowedRoles.includes(member.role)) {
    const redirect = await getRedirect();
    redirect("/access-denied");
    throw new Error("Access denied.");
  }
  if (!member.subscriptionActive) {
    const redirect = await getRedirect();
    redirect(`/subscribe?workspace=${member.workspaceId}`);
    throw new Error("An active subscription is required.");
  }
  return member;
}
