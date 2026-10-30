import { flowInputSchema, type FlowInput } from "./flows.ts";

export type FlowAuditFinding = {
  id: string;
  severity: "error" | "warning" | "pass";
  label: string;
  step?: number;
};

const isMessage = (type: FlowInput["steps"][number]["type"]) => type === "send_email" || type === "ai_auto_reply";
function allActions(steps: FlowInput["steps"]): FlowInput["steps"] {
  return steps.flatMap((step) => {
    if (step.type !== "split" || !Array.isArray(step.config.paths)) return [step];
    const nested = step.config.paths.flatMap((path) => path && typeof path === "object" && !Array.isArray(path) && Array.isArray(path.steps) ? path.steps : []) as unknown as FlowInput["steps"];
    return [step, ...allActions(nested)];
  });
}

export function auditFlowDefinition(flow: FlowInput): FlowAuditFinding[] {
  const findings: FlowAuditFinding[] = [];
  const validation = flowInputSchema.safeParse(flow);
  findings.push({ id: "schema", severity: validation.success ? "pass" : "error", label: validation.success ? "All required settings are complete" : validation.error.issues[0]?.message || "Required settings are incomplete" });

  const actions = allActions(flow.steps);
  const messages = actions.filter((step) => isMessage(step.type));
  findings.push({ id: "reply-safety", severity: messages.every((step) => step.type !== "send_email" || step.config.stopOnReply !== false) ? "pass" : "error", label: messages.every((step) => step.type !== "send_email" || step.config.stopOnReply !== false) ? "Every template email stops after a customer reply" : "A template email can send after the customer replies" });

  let unpaced = false;
  function checkPacing(steps: FlowInput["steps"], pendingMessage = false): boolean {
    for (const step of steps) {
      if (step.type === "stop") return false;
      if (step.type === "split" && Array.isArray(step.config.paths)) {
        const tails = step.config.paths.map((path) => path && typeof path === "object" && !Array.isArray(path) && Array.isArray(path.steps) ? checkPacing(path.steps as FlowInput["steps"], false) : false);
        pendingMessage = tails.some(Boolean);
      } else if (step.type === "wait" || step.type === "if_condition") pendingMessage = false;
      else if (isMessage(step.type)) { if (pendingMessage) unpaced = true; pendingMessage = true; }
    }
    return pendingMessage;
  }
  checkPacing(flow.steps);
  findings.push({ id: "message-pacing", severity: unpaced ? "warning" : "pass", label: unpaced ? "A customer path sends consecutive messages without a delay or decision, including across a branch join" : "Messages are separated by a delay or decision" });

  const anytime = messages.filter((step) => step.config.sendWindow === "anytime").length;
  findings.push({ id: "send-window", severity: anytime ? "warning" : "pass", label: anytime ? `${anytime} message action${anytime === 1 ? " can" : "s can"} send outside business hours` : "All message actions respect business hours" });

  const replyDecision = actions.some((step) => step.type === "if_condition" && step.config.field === "customer_replied");
  findings.push({ id: "journey-exit", severity: messages.length > 1 && !replyDecision ? "warning" : "pass", label: messages.length > 1 && !replyDecision ? "Multi-message journey has no explicit customer-reply decision" : "Journey has an appropriate reply exit" });

  const companyUpdate = actions.some((step) => step.type === "update_company");
  const companyScoped = Boolean(flow.triggerConfig.flowScope === "company" || flow.triggerConfig.scopeCompanyId);
  if (companyUpdate) findings.push({ id: "company-context", severity: companyScoped || flow.triggerType !== "email_received" ? "pass" : "warning", label: companyScoped || flow.triggerType !== "email_received" ? "Company updates have B2B context" : "Company update may be skipped if an email has no linked company" });

  return findings;
}

export function flowAuditCanLaunch(findings: FlowAuditFinding[]) {
  return findings.every((finding) => finding.severity !== "error");
}
