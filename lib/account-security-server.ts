import "server-only";
import { createClient } from "./supabase/server";
import { createSupabaseControl } from "./supabase/control";
import type { DeviceSession } from "./account-security";

/** The only reader allowed before MFA. Returns account security state, never CRM data. */
export async function readAccountSecurity() {
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims) throw new Error("Sign in again to manage account security.");
  const claims = data.claims;
  const { data: state, error: stateError } = await createSupabaseControl().rpc("read_account_security", {
    p_user_id: claims.sub, p_session_id: claims.session_id,
  }).maybeSingle();
  const account = state as { id: string; mfa_required: boolean } | null;
  if (stateError || !account || account.id !== claims.sub || typeof account.mfa_required !== "boolean") throw new Error("Unable to verify your account session. Sign in again.");
  return { client, userId: claims.sub, sessionId: String(claims.session_id), requiresMfa: account.mfa_required && claims.aal !== "aal2" };
}

export async function readDeviceSessions() {
  const security = await readAccountSecurity();
  if (security.requiresMfa) throw new Error("Complete two-step verification first.");
  const { data, error } = await createSupabaseControl().rpc("list_account_sessions", { p_user_id: security.userId, p_session_id: security.sessionId });
  if (error) throw new Error("Unable to load your devices. Please try again.");
  return (data ?? []) as DeviceSession[];
}
