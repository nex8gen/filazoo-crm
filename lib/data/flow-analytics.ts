import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { listWorkspaceFlows } from "./flows.ts";
import { analyticsStart, summarizeFlowAnalytics, type AnalyticsFlow, type AnalyticsRun, type AnalyticsLog, type FlowAnalyticsRange } from "../flow-analytics.ts";

type PageResult = { data: unknown[] | null; error: { message: string } | null; count: number | null };

// The caller supplies only definitions returned by the workspace visibility check.
export async function readFlowAnalytics(client: ReturnType<typeof createSupabaseAdmin>, flows: AnalyticsFlow[], range: FlowAnalyticsRange, now = new Date()) {
  async function read<T>(query: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      const result = await query(rows.length, rows.length + 499);
      if (result.error) throw new Error(`Unable to load workflow analytics: ${result.error.message}`);
      const batch = (result.data ?? []) as T[];
      rows.push(...batch);
      if (result.count !== null && rows.length >= result.count) return rows;
      if (!batch.length) {
        if (result.count !== null && rows.length < result.count) throw new Error("Workflow analytics could not be loaded completely. Please refresh.");
        return rows;
      }
      if (result.count === null && batch.length < 500) return rows;
    }
  }
  const runs: AnalyticsRun[] = [], logs: AnalyticsLog[] = [];
  const since = analyticsStart(range, now);
  for (let offset = 0; offset < flows.length; offset += 100) {
    runs.push(...await read<AnalyticsRun>((from, to) => client.from("flow_runs")
      .select("id,flow_id,status,started_at,finished_at,execution_state:context->>executionState", { count: "exact" })
      .in("flow_id", flows.slice(offset, offset + 100).map(flow => flow.id)).order("id").range(from, to)));
  }
  for (let offset = 0; offset < runs.length; offset += 100) {
    logs.push(...await read<AnalyticsLog>((from, to) => {
      let query = client.from("flow_run_logs").select("id,run_id,created_at,error,result", { count: "exact" })
        .in("run_id", runs.slice(offset, offset + 100).map(run => run.id)).lte("created_at", now.toISOString());
      if (since) query = query.gte("created_at", since);
      return query.order("id").range(from, to);
    }));
  }
  return summarizeFlowAnalytics(flows, runs, logs, range, now);
}

export async function getFlowAnalytics(range: FlowAnalyticsRange) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const flows = await listWorkspaceFlows();
  const report = await readFlowAnalytics(createSupabaseAdmin(), flows.map(({ id, name, status }) => ({ id, name, status })), range);
  return { report, canEdit: viewer.role !== "viewer" };
}
