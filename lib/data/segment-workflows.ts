import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { getCrmDataMode } from "./crm.ts";
import { isEmailScopedFlow } from "../flows.ts";
import { summarizeSegmentWorkflows, type SegmentWorkflowDefinition, type SegmentWorkflowRun, type SegmentWorkflowLog } from "../segment-workflow-metrics.ts";

export async function listSegmentWorkflowMetrics(visibleCompanyIds: string[]) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  if (getCrmDataMode() !== "live") return [];
  const admin = createSupabaseAdmin();
  const flows: SegmentWorkflowDefinition[] = [];
  const allowedCompanies = viewer.role === "bd_manager" ? new Set(visibleCompanyIds) : null;
  for (let offset = 0; ; offset += 1000) {
    const { data } = await admin.from("flows").select("id,name,status,trigger_config")
      .eq("trigger_type", "company_segment_changed").order("id").range(offset, offset + 999).throwOnError();
    flows.push(...((data ?? []) as SegmentWorkflowDefinition[]).filter(flow => !allowedCompanies || !isEmailScopedFlow(flow.trigger_config)
      || (typeof flow.trigger_config.scopeCompanyId === "string" && allowedCompanies.has(flow.trigger_config.scopeCompanyId))));
    if (!data || data.length < 1000) break;
  }
  const runs: SegmentWorkflowRun[] = [];
  for (let batch = 0; batch < flows.length; batch += 100) {
    for (let offset = 0; ; offset += 1000) {
      const { data } = await admin.from("flow_runs").select("id,flow_id,company_id,status,execution_state:context->>executionState")
        .in("flow_id", flows.slice(batch, batch + 100).map(flow => flow.id)).order("id").range(offset, offset + 999).throwOnError();
      runs.push(...((data ?? []) as SegmentWorkflowRun[]).filter(run => !allowedCompanies || (run.company_id !== null && allowedCompanies.has(run.company_id))));
      if (!data || data.length < 1000) break;
    }
  }
  const logs: SegmentWorkflowLog[] = [];
  for (let batch = 0; batch < runs.length; batch += 100) {
    for (let offset = 0; ; offset += 1000) {
      const { data } = await admin.from("flow_run_logs").select("id,run_id,result")
        .in("run_id", runs.slice(batch, batch + 100).map(run => run.id)).eq("result->>action", "email_sent")
        .order("id").range(offset, offset + 999).throwOnError();
      logs.push(...(data ?? []) as SegmentWorkflowLog[]);
      if (!data || data.length < 1000) break;
    }
  }
  return summarizeSegmentWorkflows(flows, runs, logs);
}
