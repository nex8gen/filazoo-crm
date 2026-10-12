import { createClient } from "@supabase/supabase-js";
import { env } from "../env.ts";
export function createSupabaseAdmin(){if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.supabaseSecretKey)throw new Error("Supabase is not configured. Add its URL and secret key to the server environment.");return createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.supabaseSecretKey,{auth:{persistSession:false,autoRefreshToken:false}})}
