import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), true);

const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const validSecret = secret && secret !== "[SENSITIVE]" && (secret.startsWith("sb_secret_") || secret.split(".").length === 3);

if (!validSecret) {
  console.error([
    "Local CRM startup stopped: the Supabase server key is missing.",
    "Set SUPABASE_SECRET_KEY in .env.development.local.",
    "Copy a secret key from Supabase Dashboard → Project Settings → API Keys.",
    "Vercel intentionally does not download sensitive environment values.",
  ].join("\n"));
  process.exit(1);
}
