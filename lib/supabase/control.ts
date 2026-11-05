import { createClient } from "@supabase/supabase-js";
import { env } from "../env.ts";
import { sessionFetch } from "./session-fetch.ts";

/** Server-only identity/provisioning access. Never use for CRM record queries. */
export function createSupabaseControl() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.supabaseSecretKey) throw new Error("Supabase server authentication is not configured.");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-crm-control": "1" }, fetch: sessionFetch() },
  });
}
