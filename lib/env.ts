import "server-only";
import { z } from "zod";
const optionalUrl=z.string().url().optional().or(z.literal(""));
const schema=z.object({NEXT_PUBLIC_APP_URL:optionalUrl.default("http://localhost:3000"),NEXT_PUBLIC_SUPABASE_URL:optionalUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:z.string().optional(),NEXT_PUBLIC_SUPABASE_ANON_KEY:z.string().optional(),SUPABASE_SECRET_KEY:z.string().optional(),SUPABASE_SERVICE_ROLE_KEY:z.string().optional(),AUTH_REQUIRED:z.enum(["true","false"]).default("false"),ANTHROPIC_API_KEY:z.string().optional(),GOOGLE_SHEET_ID:z.string().optional(),DRY_RUN:z.enum(["true","false"]).default("true"),DAILY_SEND_LIMIT:z.coerce.number().int().positive().max(200).default(20),BOUNCE_PAUSE_PERCENT:z.coerce.number().positive().max(100).default(3)});
const parsed=schema.safeParse(process.env);
if(!parsed.success)throw new Error(`Invalid server environment: ${parsed.error.message}`);
export const env={
  ...parsed.data,
  supabasePublishableKey:parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseSecretKey:parsed.data.SUPABASE_SECRET_KEY||parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  authRequired:parsed.data.AUTH_REQUIRED==="true",
  dryRun:parsed.data.DRY_RUN!=="false",
};
export function hasSupabaseAuthConfig(){return Boolean(env.NEXT_PUBLIC_SUPABASE_URL&&env.supabasePublishableKey)}
export function hasSupabaseConfig(){return Boolean(hasSupabaseAuthConfig()&&env.supabaseSecretKey)}
