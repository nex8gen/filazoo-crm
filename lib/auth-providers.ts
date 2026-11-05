import { env, hasSupabaseAuthConfig } from "./env";

export type AuthProvider = "google" | "apple";

// The public Auth settings expose enabled providers, never credentials.
export async function getAuthProviders(): Promise<AuthProvider[]> {
  if (!hasSupabaseAuthConfig()) return [];
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.supabasePublishableKey! }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const settings = await response.json();
    return (["google", "apple"] as const).filter(provider => settings.external?.[provider] === true);
  } catch { return []; }
}
