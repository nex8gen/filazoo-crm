import { auditFlowDefinition, type FlowAuditFinding } from "./flow-audit.ts";
import type { FlowConnectorHealth } from "./flow-connector-health.ts";
import { flowActionLocations, flowActionTrail } from "./flow-tree.ts";
import { flowActionConfigIssue, flowInputSchema, stepLabels, type FlowInput, type FlowStepType } from "./flows.ts";

export type FlowAlert = {
  id: string;
  severity: "error" | "warning";
  title: string;
  detail: string;
  target: "action" | "trigger" | "workflow" | "checks" | "audit";
  actionId?: string;
  actionLabel?: string;
  step?: number;
  trail?: string[];
};

const setupTitles: Record<FlowStepType, string> = {
  send_email: "Set up email", ai_auto_reply: "Set up AI auto-reply", wait: "Set up time delay",
  create_task: "Set up CRM task", internal_alert: "Set up internal alert", change_category: "Set up customer tag",
  update_company: "Set up property update", split: "Set up split paths", if_condition: "Set up condition", stop: "Set up stop action",
};

/** Definition checks include unsaved/new actions, even when no live-health request can run. */
export function flowAlerts(flow: FlowInput, health?: FlowConnectorHealth, findings = auditFlowDefinition(flow)): FlowAlert[] {
  const alerts: FlowAlert[] = [];
  for (const [index, { action, path }] of flowActionLocations(flow.steps).entries()) {
    const configIssue = flowActionConfigIssue(action.type, action.config)
      || (action.type === "send_email" && action.config.stopOnReply === false ? "This email must stop after a customer reply" : null);
    const runtime = action.id ? health?.actions?.[action.id] : undefined;
    const detail = configIssue || (runtime && ["error", "unknown"].includes(runtime.state) ? runtime.message : null);
    if (!detail) continue;
    alerts.push({ id: `action:${action.id ?? path.join(".")}:${configIssue ? "configuration" : "runtime"}`, severity: configIssue || runtime?.state === "error" ? "error" : "warning",
      title: configIssue ? setupTitles[action.type] : "Action needs attention", detail, target: "action", actionId: action.id,
      actionLabel: action.type === "wait" ? "Time delay" : action.type === "send_email" ? "Email" : stepLabels[action.type],
      step: index + 1, trail: flowActionTrail(flow.steps, path) });
  }
  const validation = flowInputSchema.safeParse(flow);
  if (!validation.success) {
    const triggerIssue = validation.error.issues.find(issue => issue.path[0] === "triggerType" || issue.path[0] === "triggerConfig");
    if (triggerIssue) alerts.unshift({ id: "trigger:configuration", severity: "error", title: "Set up trigger", detail: triggerIssue.message, target: "trigger" });
    const definitionIssue = validation.error.issues.find(issue => !["triggerType", "triggerConfig", "steps"].includes(String(issue.path[0])) || issue.path[0] === "steps" && issue.path.length === 1);
    if (definitionIssue) alerts.push({ id: "workflow:configuration", severity: "error", title: "Complete workflow settings", detail: definitionIssue.message, target: "workflow" });
  }
  for (const finding of findings) {
    if (finding.severity !== "error" || finding.id === "schema" || finding.id === "reply-safety") continue;
    alerts.push(auditAlert(finding));
  }
  // Summary-only service failures have no arbitrary action assigned to them.
  if (health?.state === "error" && health.message && !alerts.some(alert => alert.detail === health.message)) {
    // A schema summary describes the first issue already attached to its action.
    const schemaMessage = !validation.success ? validation.error.issues[0]?.message : null;
    const replySafetySummary = findings.some(finding => finding.id === "reply-safety" && finding.label === health.message && finding.severity === "error");
    if (health.message !== schemaMessage && !replySafetySummary) alerts.push({ id: "workflow:health", severity: "error", title: "Workflow needs attention", detail: health.message, target: "checks" });
  }
  if (health?.state === "unknown" && health.message && !["Checking workflow health", "Save changes to verify this live workflow"].includes(health.message) && !alerts.some(alert => alert.detail === health.message)) alerts.push({ id: "workflow:connection", severity: "warning", title: "Connection checks need review", detail: health.message, target: "checks" });
  return alerts;
}

function auditAlert(finding: FlowAuditFinding): FlowAlert {
  return { id: `audit:${finding.id}`, severity: finding.severity === "error" ? "error" : "warning", title: "Review workflow", detail: finding.label, target: finding.id === "live-sending" ? "checks" : "audit" };
}

/** A changed problem becomes active again; dismissing never changes its validation. */
export function flowAlertKey(alert: FlowAlert) {
  return JSON.stringify([alert.id, alert.severity, alert.detail]);
}

export function partitionFlowAlerts(alerts: FlowAlert[], dismissedKeys: readonly string[]) {
  const dismissed = new Set(dismissedKeys);
  return { active: alerts.filter(alert => !dismissed.has(flowAlertKey(alert))), dismissed: alerts.filter(alert => dismissed.has(flowAlertKey(alert))) };
}
