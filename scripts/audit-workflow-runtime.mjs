// Read-only workflow audit. Never executes runs, sends emails, or prints credentials.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
nextEnv.loadEnvConfig(process.cwd(), true);
const flowId = process.argv[2];
if (!/^[\da-f-]{36}$/i.test(flowId || "")) throw new Error("Pass a workflow UUID.");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
});
async function pages(make) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await make().range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
const { data: flow, error } = await admin.from("flows").select("id,name,status,trigger_type,trigger_config,created_at,updated_at,workspace_id").eq("id", flowId).single();
if (error) throw new Error(error.message);
const [steps, runs] = await Promise.all([
  pages(() => admin.from("flow_steps").select("id,position,type,config").eq("flow_id", flowId).order("position").order("id")),
  pages(() => admin.from("flow_runs").select("id,status,current_step,next_run_at,locked_at,started_at,finished_at,contact_id,company_id,context").eq("flow_id", flowId).order("id")),
]);
const logs = [];
for (let i = 0; i < runs.length; i += 100) logs.push(...await pages(() => admin.from("flow_run_logs").select("id,run_id,error,result,created_at").in("run_id", runs.slice(i, i + 100).map(r => r.id)).order("id")));
const countBy = (rows, key) => Object.fromEntries([...new Set(rows.map(key))].map(k => [k, rows.filter(row => key(row) === k).length]));
const safeError = value => String(value || "").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
const active = runs.filter(r => r.status === "active");
const snapshots = runs.map(r => { try { return { status: r.status, steps: typeof r.context?.definition === "string" ? JSON.parse(r.context.definition).map(s => ({ type: s.type, config: s.config })) : null }; } catch { return { status: r.status, steps: "invalid JSON" }; } });
const redactedStep = step => ({ ...step, config: { ...step.config, ...(step.config.instructions ? { instructions: `[${step.config.instructions.length} characters]` } : {}) } });
console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  flow,
  steps: steps.map(redactedStep),
  runs: { total: runs.length, byStatus: countBy(runs, r => r.status), byStepAndStatus: countBy(runs, r => `${r.current_step}:${r.status}`), firstStarted: runs.map(r => r.started_at).sort()[0], lastStarted: runs.map(r => r.started_at).sort().at(-1) },
  active: { due: active.filter(r => !r.next_run_at || Date.parse(r.next_run_at) <= Date.now()).length, future: active.filter(r => Date.parse(r.next_run_at) > Date.now()).length, locked: active.filter(r => r.locked_at).length, details: active.map(({ id,status,current_step,next_run_at,locked_at,started_at }) => ({ id,status,current_step,next_run_at,locked_at,started_at })) },
  errors: countBy(logs.filter(l => l.error), l => safeError(l.error)),
  actions: countBy(logs.filter(l => l.result?.action), l => l.result.action),
  errorDates: countBy(logs.filter(l => l.error), l => l.created_at.slice(0,10)),
  lastActivity: logs.map(l => l.created_at).sort().at(-1),
  definitions: countBy(snapshots, s => JSON.stringify({status:s.status,steps:Array.isArray(s.steps)?s.steps.map(redactedStep):s.steps})),
}, null, 2));
const missing = runs.filter(r => !r.contact_id);
const missingCompanies = [...new Set(missing.map(r => r.company_id).filter(Boolean))];
const companyContacts = missingCompanies.length ? await admin.from("contacts").select("company_id,email,verification_status,unsubscribed").in("company_id", missingCompanies) : { data: [], error: null };
const [allFlows, aiSettings] = await Promise.all([
  admin.from("flows").select("id,name,status,trigger_type").eq("workspace_id", flow.workspace_id),
  admin.from("workspace_ai_settings").select("policy,revision,updated_at").eq("workspace_id", flow.workspace_id),
]);
console.log(JSON.stringify({
  missingContacts: { runCount: missing.length, companies: missingCompanies.map(id => ({ id, contacts: (companyContacts.data || []).filter(c => c.company_id === id).length, withEmail: (companyContacts.data || []).filter(c => c.company_id === id && c.email?.trim()).length })), queryError: companyContacts.error?.message },
  workspaceWorkflows: allFlows.data,
  aiSettings: (aiSettings.data || []).map(s => ({ revision:s.revision, updatedAt:s.updated_at, enabled:s.policy.enabled, automation:s.policy.features?.automation, email:s.policy.features?.email, sending:s.policy.actions?.sending, catalogs:s.policy.actions?.catalogs })),
}, null, 2));
const liveFlows = (allFlows.data || []).filter(f => f.status === "live");
const liveRuns = liveFlows.length ? await pages(() => admin.from("flow_runs").select("id,flow_id,status,next_run_at,locked_at,started_at,finished_at").in("flow_id", liveFlows.map(f => f.id)).order("id")) : [];
const liveErrors = [];
for (let i = 0; i < liveRuns.length; i += 100) liveErrors.push(...await pages(() => admin.from("flow_run_logs").select("run_id,error,created_at").in("run_id", liveRuns.slice(i, i+100).map(r => r.id)).not("error", "is", null).order("id")));
console.log(JSON.stringify({ liveWorkflowAudit: liveFlows.map(f => { const current = liveRuns.filter(r => r.flow_id === f.id); const ids = new Set(current.map(r => r.id)); return { id:f.id, name:safeError(f.name), trigger:f.trigger_type, runs:countBy(current,r=>r.status), due:current.filter(r=>r.status==="active"&&(!r.next_run_at||Date.parse(r.next_run_at)<=Date.now())).length, errors:countBy(liveErrors.filter(e=>ids.has(e.run_id)),e=>safeError(e.error)) }; }) }, null, 2));
