// Package only the modules/assets needed by the approved, checkpointed QA test.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
const stage = ".vercel/task-workflow-qa";
mkdirSync(stage, { recursive: true });
for (const path of ["lib", "components/brand-mark.tsx", "public/fonts", "public/paid-stamp.png", "public/catalog-default-product.jpg", "package.json", "package-lock.json", "scripts/run-task-verification.cjs", "scripts/verify-task-workflows.ts", "tmp/task-workflow-live-checkpoint.json"]) cpSync(path, `${stage}/${path}`, { recursive: true });
const values = parseEnv(readFileSync(".env.local", "utf8"));
const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "GEMINI_AGENT_MODEL", "GEMINI_EMAIL_MODEL", "DRY_RUN", "DAILY_SEND_LIMIT", "BOUNCE_PAUSE_PERCENT"];
writeFileSync(`${stage}/.env.local`, keys.filter(key => values[key] !== undefined).map(key => `${key}=${JSON.stringify(values[key])}`).join("\n"));
execFileSync("tar", ["-czf", ".vercel/task-workflow-qa.tar.gz", "-C", stage, "."]);
console.log("Prepared scoped test package and existing checkpoint. Credentials are not printed.");
