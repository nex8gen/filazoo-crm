import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
export function createSupabaseAdmin(){if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Supabase is not configured. Add its URL and service role key to .env.local.");return createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}
