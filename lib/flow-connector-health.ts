import { flowActionConfigIssue, flowInputSchema, type FlowInput } from "./flows.ts";
import { auditFlowDefinition } from "./flow-audit.ts";
import type { FlowCheckResult } from "./flow-check.ts";
import { flowActionLocations } from "./flow-tree.ts";

export type FlowConnectionState = "idle" | "live" | "error" | "unknown";
export type FlowActionHealth = { state: FlowConnectionState; message: string };
export type FlowRuntimeIssue = { actionId: string | null; message: string };
export type FlowConnectorHealth = FlowActionHealth & { connectionState?: FlowConnectionState; actions?: Record<string, FlowActionHealth> };
export type FlowHealthEvidence = { checks?: FlowCheckResult; runtimeIssue?: string | null; runtimeIssues?: FlowRuntimeIssue[]; readError?: string };

function flowSummaryHealth(flow: FlowInput | null, evidence?: FlowHealthEvidence, dependencyIssue?: string, saved = true): FlowActionHealth {
  if (!flow) return { state: "idle", message: "Workflow is not running" };
  const validation = flowInputSchema.safeParse(flow);
  if (!validation.success) return { state: "error", message: validation.error.issues[0]?.message || "Complete the action settings" };
  const auditIssue = auditFlowDefinition(flow).find(finding => finding.severity === "error");
  const blocked = evidence?.checks?.checks.find(check => check.status === "blocked" || ["queue", "sending"].includes(check.id) && check.status === "warning");
  const blockedMessage = blocked?.id === "sending" ? "Email delivery is temporarily unavailable. Please try again later or contact support." : blocked?.detail;
  const issue = dependencyIssue || auditIssue?.label || evidence?.runtimeIssue || blockedMessage;
  if (issue) return { state: "error", message: issue };
  if (flow.status !== "live") return { state: "idle", message: flow.status === "paused" ? "Workflow is paused" : "Workflow is a draft" };
  if (!saved) return { state: "unknown", message: "Save changes to verify this live workflow" };
  if (evidence?.readError) return { state: "unknown", message: evidence.readError };
  const unverified = evidence?.checks?.checks.find(check => check.status === "unverified");
  if (unverified) return { state: "unknown", message: unverified.detail };
  if (!evidence?.checks || evidence.runtimeIssue === undefined) return { state: "unknown", message: "Checking workflow health" };
  return { state: "live", message: "Live · connection checks passed; no reported run failures" };
}

/** A workflow summary never supplies a color to all of its action connections. */
export function flowConnectorHealth(flow: FlowInput | null, evidence?: FlowHealthEvidence, dependencyIssue?: string, saved = true): FlowConnectorHealth {
  const summary = flowSummaryHealth(flow, evidence, dependencyIssue, saved);
  const connectionState: FlowConnectionState = !flow || flow.status !== "live" ? "idle"
    : !saved || !evidence?.checks || evidence.runtimeIssue === undefined || evidence.readError ? "unknown" : "live";
  const actions: Record<string, FlowActionHealth> = {};
  if (!flow) return { ...summary, connectionState, actions };
  const locations = flowActionLocations(flow.steps);
  for (const { action } of locations) {
    if (!action.id) continue;
    const issue = flowActionConfigIssue(action.type, action.config)
      || (action.type === "send_email" && action.config.stopOnReply === false ? "This email must stop after a customer reply" : null);
    actions[action.id] = { state: issue ? "error" : connectionState, message: issue || "" };
  }
  for (const check of evidence?.checks?.checks ?? []) {
    const blocked = check.status === "blocked" || check.id === "sending" && check.status === "warning";
    if (!blocked && check.status !== "unverified") continue;
    for (const { action, path } of locations) {
      if (!action.id) continue;
      const targetedPaths = check.actionPaths ?? (check.actionPath ? [check.actionPath] : null);
      const sends = action.type === "send_email" || action.type === "ai_auto_reply";
      const affected = targetedPaths ? targetedPaths.some(target => target.join(".") === path.join("."))
        : check.id === "sending" ? sends || action.type === "internal_alert" && action.config.channel === "email"
        : check.id === "senders" ? sends || action.type === "internal_alert" && action.config.channel === "email"
        : check.id === "ai" ? action.type === "ai_auto_reply"
        : check.id === "products" ? action.type === "send_email" && action.config.templateId === "send_catalog" || action.type === "ai_auto_reply" && Boolean(action.config.useProducts || action.config.attachCatalog)
        : check.id === "members" ? action.type === "create_task" && action.config.assigneeType === "user" || action.type === "internal_alert" && action.config.userId !== "owner"
        : false;
      if (affected && actions[action.id].state !== "error") actions[action.id] = { state: blocked ? "error" : "unknown", message: check.detail };
    }
  }
  for (const issue of evidence?.runtimeIssues ?? []) {
    if (issue.actionId && actions[issue.actionId]) actions[issue.actionId] = { state: "error", message: issue.message };
  }
  return { ...summary, connectionState, actions };
}

type HealthRun = {
  status: string;
  uncertain?: boolean;
  retry?: { reason?: string; stepId?: string | null } | null;
  currentActionId?: string | null;
  flow_run_logs?: Array<{ error: string | null; created_at: string; step_id?: string | null; result?: { stepId?: string | null } | null }>;
};

/** Inspect unresolved failures and all active pages; completed history is not a current failure. */
async function readRuntimeIssues(flowId: string, signal: AbortSignal, fetcher: typeof fetch, firstOnly: boolean): Promise<FlowRuntimeIssue[]> {
  async function page(status: "failed" | "active", index: number) {
    const response = await fetcher(`/api/flows/${encodeURIComponent(flowId)}/runs?status=${status}&page=${index}`, { cache: "no-store", signal });
    const result = await response.json() as { ok?: boolean; error?: string; runs?: HealthRun[]; hasMore?: boolean };
    if (!response.ok || !result.ok || !Array.isArray(result.runs)) throw new Error(result.error || "Run health could not be verified");
    return { runs: result.runs, hasMore: result.hasMore === true };
  }
  const issues: FlowRuntimeIssue[] = [];
  for (const status of ["failed", "active"] as const) {
    for (let index = 0; index <= 1000; index++) {
      const result = await page(status, index);
      for (const run of result.runs) {
        const error = [...run.flow_run_logs ?? []].filter(log => log.error).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        const message = status === "failed" ? error?.error || "An action failed. Review the run in Insights."
          : run.uncertain ? "An action's delivery could not be confirmed. Review Insights."
          : run.retry ? run.retry.reason || "An action is blocked or waiting for a retry. Review Insights." : null;
        if (!message) continue;
        const actionId = run.currentActionId || run.retry?.stepId || (status === "failed" ? error?.step_id || error?.result?.stepId : null) || null;
        if (!issues.some(issue => issue.actionId === actionId && issue.message === message)) issues.push({ actionId, message });
        if (firstOnly) return issues;
      }
      if (!result.hasMore) break;
      if (!result.runs.length || index === 1000) throw new Error("Run health could not be loaded completely");
    }
  }
  return issues;
}

export async function readFlowRuntimeIssue(flowId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string | null> {
  return (await readRuntimeIssues(flowId, signal, fetcher, true))[0]?.message ?? null;
}

export async function readFlowRuntimeIssues(flowId: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<FlowRuntimeIssue[]> {
  return readRuntimeIssues(flowId, signal, fetcher, false);
}
