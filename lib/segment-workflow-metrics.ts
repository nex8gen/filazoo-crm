import type { FlowStatus, JsonConfig } from "./flows.ts";

export type WorkflowCounts = { active: number; blocked: number; completed: number; cancelled: number; failed: number; emailsSent: number };
export type SegmentWorkflowMetric = WorkflowCounts & { id: string; name: string; status: FlowStatus; segmentKey: string };
export type SegmentWorkflowDefinition = { id: string; name: string; status: FlowStatus; trigger_config: JsonConfig };
export type SegmentWorkflowRun = { id: string; flow_id: string; company_id: string | null; status: string; execution_state?: string | null };
export type SegmentWorkflowLog = { id: string; run_id: string; result: JsonConfig | null };

export function emptyWorkflowCounts(): WorkflowCounts {
  return { active: 0, blocked: 0, completed: 0, cancelled: 0, failed: 0, emailsSent: 0 };
}

// Saved audiences use identity, never their mutable name. Legacy business
// segment triggers have no segmentAudience flag but still target that segment.
export function workflowSegmentKey(config: JsonConfig): string | null {
  if (typeof config.savedSegmentId === "string" && config.savedSegmentId) return config.savedSegmentId;
  return typeof config.segment === "string" && config.segment ? `business:${config.segment}` : null;
}

export function summarizeSegmentWorkflows(flows: SegmentWorkflowDefinition[], runs: SegmentWorkflowRun[], logs: SegmentWorkflowLog[]): SegmentWorkflowMetric[] {
  const metrics = new Map<string, SegmentWorkflowMetric>(flows.flatMap(flow => {
    const segmentKey = workflowSegmentKey(flow.trigger_config);
    return segmentKey ? [[flow.id, { id: flow.id, name: flow.name, status: flow.status, segmentKey, ...emptyWorkflowCounts() }] as const] : [];
  }));
  const runFlows = new Map<string, string>();
  for (const run of runs) {
    const metric = metrics.get(run.flow_id);
    if (!metric || runFlows.has(run.id)) continue;
    runFlows.set(run.id, run.flow_id);
    if (run.status === "active" && run.execution_state === "blocked") metric.blocked++;
    else if (run.status === "active") metric.active++;
    else if (run.status === "done") metric.completed++;
    else if (run.status === "cancelled") metric.cancelled++;
    else if (run.status === "failed") metric.failed++;
  }
  const sent = new Set<string>();
  for (const log of logs) {
    const flowId = runFlows.get(log.run_id);
    const metric = flowId ? metrics.get(flowId) : undefined;
    if (!metric || log.result?.action !== "email_sent") continue;
    const key = `${flowId}:${typeof log.result.messageId === "string" && log.result.messageId ? log.result.messageId : log.id}`;
    if (sent.has(key)) continue;
    sent.add(key);
    metric.emailsSent++;
  }
  return [...metrics.values()];
}

export function totalWorkflowCounts(metrics: WorkflowCounts[]): WorkflowCounts {
  return metrics.reduce((total, metric) => ({ active: total.active + metric.active, blocked: total.blocked + metric.blocked, completed: total.completed + metric.completed, cancelled: total.cancelled + metric.cancelled, failed: total.failed + metric.failed, emailsSent: total.emailsSent + metric.emailsSent }), emptyWorkflowCounts());
}
