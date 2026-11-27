import { createServerClient } from "@supabase/ssr";
import { env } from "../env.ts";
import { authFetch } from "./auth-fetch.ts";

export async function createClient() {
  const key = env.supabasePublishableKey;
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !key) throw new Error("Supabase authentication is not configured.");
  // Auth eagerly reads the clock while loading cookies. Defer its initialization
  // as well as its requests so Cache Components never prerenders session state.
  const { connection } = await import("next/server");
  await connection();
  const { cookies, headers } = await import("next/headers");
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 1024);
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    // Preserve the browser label on server-side password/OAuth sign-ins. This
    // is display metadata only; it never establishes trust or authorization.
    global: { fetch: authFetch(), headers: userAgent ? { "User-Agent": userAgent } : {} },
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
