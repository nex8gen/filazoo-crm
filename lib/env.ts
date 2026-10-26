import { z } from "zod";
const optionalUrl=z.string().url().optional().or(z.literal(""));
const schema=z.object({NEXT_PUBLIC_APP_URL:optionalUrl.default("http://localhost:3000"),NEXT_PUBLIC_SUPABASE_URL:optionalUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:z.string().optional(),NEXT_PUBLIC_SUPABASE_ANON_KEY:z.string().optional(),SUPABASE_SECRET_KEY:z.string().optional(),SUPABASE_SERVICE_ROLE_KEY:z.string().optional(),AUTH_REQUIRED:z.enum(["true","false"]).default("false"),GEMINI_API_KEY:z.string().optional(),GEMINI_EMAIL_MODEL:z.string().optional(),GOOGLE_SHEET_ID:z.string().optional(),TWILIO_ACCOUNT_SID:z.string().optional(),TWILIO_AUTH_TOKEN:z.string().optional(),TWILIO_WHATSAPP_FROM:z.string().optional(),TWILIO_FACEBOOK_FROM:z.string().optional(),TWILIO_WEBHOOK_URL:optionalUrl,META_FACEBOOK_PAGE_ACCESS_TOKEN:z.string().optional(),META_FACEBOOK_PAGE_ID:z.string().optional(),META_WEBHOOK_SECRET:z.string().optional(),META_VERIFY_TOKEN:z.string().optional(),META_GRAPH_API_VERSION:z.string().regex(/^v\d+\.\d+$/).default("v26.0"),SHOPIFY_WEBHOOK_SECRET:z.string().optional(),SHOPIFY_STORE_DOMAIN:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).optional().or(z.literal("")),SHOPIFY_B2B_FORM_TAG:z.string().trim().max(100).default("b2b-lead"),SHOPIFY_FORM_ORIGIN:z.string().url().default("https://filazoo.com"),SHOPIFY_B2B_FORM_ID:z.string().trim().min(8).max(100).default("filazoo-b2b-2026"),DRY_RUN:z.enum(["true","false"]).default("true"),DAILY_SEND_LIMIT:z.coerce.number().int().positive().max(200).default(20),BOUNCE_PAUSE_PERCENT:z.coerce.number().positive().max(100).default(3)});
const parsed=schema.safeParse(process.env);
if(!parsed.success)throw new Error(`Invalid server environment: ${parsed.error.message}`);
export const env={
  ...parsed.data,
  supabasePublishableKey:parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  supabaseSecretKey:parsed.data.SUPABASE_SECRET_KEY||parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  authRequired:parsed.data.AUTH_REQUIRED==="true",
  dryRun:parsed.data.DRY_RUN!=="false",
};
function looksLikeSupabaseKey(value: string | undefined, prefix: string) {
  if (!value) return false;
  return value.startsWith(prefix) || value.split(".").length === 3;
}
export function hasSupabaseAuthConfig(){return Boolean(env.NEXT_PUBLIC_SUPABASE_URL&&looksLikeSupabaseKey(env.supabasePublishableKey,"sb_publishable_"))}
export function hasSupabaseConfig(){return Boolean(hasSupabaseAuthConfig()&&looksLikeSupabaseKey(env.supabaseSecretKey,"sb_secret_"))}
