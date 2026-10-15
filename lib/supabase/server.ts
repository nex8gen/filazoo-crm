import { createServerClient } from "@supabase/ssr";
import { env } from "../env.ts";

export async function createClient() {
  const key = env.supabasePublishableKey;
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !key) throw new Error("Supabase authentication is not configured.");
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. proxy.ts handles refreshes.
        }
      },
    },
  });
}
