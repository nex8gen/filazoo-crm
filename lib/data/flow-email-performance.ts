import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { validateEmailFlowScope } from "./email-flows.ts";
import { analyticsStart } from "../flow-analytics.ts";
import { reconcileFlowAiCosts } from "./flow-ai-cost.ts";
import { summarizeEmailPerformance, type EmailPerformanceLog, type EmailPerformanceRun } from "../flow-email-performance.ts";

type Page = { data: unknown[] | null; error: { message: string } | null; count: number | null };
export async function readEmailPerformance(client: ReturnType<typeof createSupabaseAdmin>, flowId: string, now = new Date()) {
  async function read<T>(query: (from: number, to: number) => PromiseLike<Page>): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      const result = await query(rows.length, rows.length + 499);
      if (result.error) throw new Error(`Unable to load email performance: ${result.error.message}`);
      const batch = (result.data ?? []) as T[];
      rows.push(...batch);
      if (result.count !== null && rows.length >= result.count) return rows;
      if (!batch.length) {
        if (result.count !== null && rows.length < result.count) throw new Error("Email performance could not be loaded completely.");
        return rows;
      }
      if (result.count === null && batch.length < 500) return rows;
    }
  }
  const [logs, runs] = await Promise.all([
    read<EmailPerformanceLog>((from, to) => client.from("flow_run_logs").select("id,run_id,step_id,created_at,result,error,flow_runs!inner(flow_id)", { count: "exact" }).eq("flow_runs.flow_id", flowId).or(`created_at.gte.${analyticsStart("30", now)!},result->>action.eq.ai_usage,result->>aiGenerated.eq.true`).lte("created_at", now.toISOString()).order("id").range(from, to)),
    read<EmailPerformanceRun>((from, to) => client.from("flow_runs").select("id,status,current_step,next_run_at,context", { count: "exact" }).eq("flow_id", flowId).in("status", ["active", "failed"]).order("id").range(from, to)),
  ]);
  await reconcileFlowAiCosts(client, logs, now);
  return summarizeEmailPerformance(logs, runs, now);
}

export async function getEmailPerformance(flowId: string) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const client = createSupabaseAdmin();
  const { data: flow, error } = await client.from("flows").select("id,trigger_config").eq("id", flowId).maybeSingle();
  if (error) throw new Error("Unable to load workflow.");
  if (!flow) throw new Error("Workflow not found.");
  if (flow.trigger_config?.flowScope) await validateEmailFlowScope(flow.trigger_config);
  return readEmailPerformance(client, flow.id);
}
