import nextEnv from "@next/env";
import { checkLocalSupabase, localSupabaseConfig } from "./local-supabase-check.mjs";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), true);

const config = localSupabaseConfig(process.env);
const errors = config.errors.length ? config.errors : await checkLocalSupabase(config);
if (errors.length) {
  console.error(["Local CRM startup stopped:", ...errors].join("\n"));
  process.exit(1);
}
console.log("Local CRM: Supabase authentication and database connection verified.");
if (process.env.npm_lifecycle_event === "predev") {
  console.log("Development mode compiles pages on demand and disables automatic prefetching. For normal CRM use, stop this server and run npm run crm at http://localhost:3000.");
}
