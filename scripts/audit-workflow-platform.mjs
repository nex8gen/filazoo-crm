// Read-only platform metadata. Never decrypts secrets or invokes production workers.
import { readFileSync, existsSync } from "node:fs";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
nextEnv.loadEnvConfig(process.cwd(), true);
const teamId = "team_TuvssrxhHF8qgyVEckWNUiBq";
const projectId = "prj_8FpTI4sEU5vUDrochgFpT3IjCXCn";
const fetchRead = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchRead, headers: { "x-crm-control": "1" } } });
const workspace = await db.from("workspaces").select("id", { count: "exact" });
console.log(JSON.stringify({ workspaces: { count: workspace.count, error: workspace.error?.message }, local: { dryRun: process.env.DRY_RUN, gatewayKeyPresent: Boolean(process.env.AI_GATEWAY_API_KEY), oidcPresent: Boolean(process.env.VERCEL_OIDC_TOKEN), cronSecretPresent: Boolean(process.env.CRON_SECRET) } }));
const authPath = `${process.env.HOME}/Library/Application Support/com.vercel.cli/auth.json`;
if (existsSync(authPath)) {
  const credentials = JSON.parse(readFileSync(authPath, "utf8"));
  const get = async (path) => { const response = await fetchRead(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${teamId}`, { headers: { Authorization: `Bearer ${credentials.token}` } }); const body = await response.json(); if (!response.ok) throw new Error(`Vercel HTTP ${response.status}: ${body.error?.message || "request failed"}`); return body; };
  try {
    const [project, deployments] = await Promise.all([get(`/v9/projects/${projectId}`), get(`/v6/deployments?projectId=${projectId}&target=production&limit=3`)]);
    console.log(JSON.stringify({ project: { name: project.name, oidcTokenConfig: project.oidcTokenConfig, latestTargets: Object.keys(project.targets || {}) }, deployments: (deployments.deployments || []).map(d => ({ id: d.uid, url: d.url, state: d.state, created: d.created, commit: d.meta?.githubCommitSha })), productionEnvNames: (project.env || []).filter(e => e.target?.includes("production")).map(e => e.key) }, null, 2));
  } catch(error) { console.log(JSON.stringify({ vercelError: error.message })); }
}
