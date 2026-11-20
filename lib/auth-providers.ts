import { env, hasSupabaseAuthConfig } from "./env";

export type AuthProvider = "google" | "apple" | "alipay";

// The public Auth settings expose enabled providers, never credentials.
export async function getAuthProviders(): Promise<AuthProvider[]> {
  if (!hasSupabaseAuthConfig()) return [];
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.supabasePublishableKey! }, cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const settings = await response.json();
    const providers: AuthProvider[] = (["google", "apple"] as const).filter(provider => settings.external?.[provider] === true);
    // Custom OAuth providers are intentionally absent from public /settings.
    // This flag is enabled together with the server-managed custom provider.
    if (process.env.ALIPAY_LOGIN_ENABLED === "true") providers.push("alipay");
    return providers;
  } catch { return []; }
}
