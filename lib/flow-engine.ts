import type { FlowInput, FlowStepType, JsonConfig, TriggerType } from "./flows.ts";

export type FlowFacts = {
  customerReplied: boolean;
  openedEmail: boolean;
  clickedLink: boolean;
  category: string | null;
  segment: string | null;
  country: string | null;
  companyStatus: string | null;
  pipelineStage: string | null;
  fitScore: number | null;
};

export type TriggerEvent = {
  type: TriggerType;
  conversationId: string;
  contactId?: string | null;
  companyId?: string | null;
  messageKey?: string | null;
  category?: string | null;
  listId?: string | null;
  segment?: string | null;
  stage?: string | null;
  eventKey?: string | null;
  flowId?: string | null;
};

export type SimulationEntry = {
  step: number;
  type: FlowStepType;
  status: "would_run" | "waiting" | "skipped" | "stopped";
  detail: string;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function matchesProfileFilters(config: JsonConfig, facts: FlowFacts) {
  if (config.segment && normalized(config.segment) !== normalized(facts.segment)) return false;
  if (config.country && normalized(config.country) !== normalized(facts.country)) return false;
  if (config.companyStatus && config.companyStatus !== facts.companyStatus) return false;
  if (config.pipelineStage && config.pipelineStage !== facts.pipelineStage) return false;
  if (typeof config.minFitScore === "number" && (facts.fitScore ?? 0) < config.minFitScore) return false;
  return true;
}

export function triggerMatches(type: TriggerType, config: JsonConfig, event: TriggerEvent, facts: FlowFacts) {
  if (event.type !== type || !matchesProfileFilters(config, facts)) return false;
  if (type === "category_changed") return normalized(config.category) === normalized(event.category);
  if (type === "lead_added_to_list") return normalized(config.listId) === normalized(event.listId);
  if (type === "company_segment_changed") return normalized(config.segment) === normalized(event.segment ?? facts.segment);
  if (type === "pipeline_stage_changed") return config.stage === (event.stage ?? facts.pipelineStage);
  return true;
}

function isWeekend(date: Date) {
  return date.getUTCDay() === 0 || date.getUTCDay() === 6;
}

function moveOffWeekend(date: Date) {
  while (isWeekend(date)) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export function calculateWaitUntil(config: JsonConfig, from = new Date()) {
  const amount = Math.max(1, Number(config.amount) || 1);
  const unit = String(config.unit || "days");
  const result = new Date(from);
  if (unit === "minutes") result.setUTCMinutes(result.getUTCMinutes() + amount);
  else if (unit === "hours") result.setUTCHours(result.getUTCHours() + amount);
  else if (config.businessDays) {
    let remaining = amount;
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() + 1);
      if (!isWeekend(result)) remaining -= 1;
    }
  } else result.setUTCDate(result.getUTCDate() + amount);

  if (config.businessDays && unit !== "days") moveOffWeekend(result);
  if (typeof config.resumeAt === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(config.resumeAt)) {
    const [hours, minutes] = config.resumeAt.split(":").map(Number);
    result.setUTCHours(hours, minutes, 0, 0);
    if (result <= from) result.setUTCDate(result.getUTCDate() + 1);
    if (config.businessDays) moveOffWeekend(result);
  }
  return result;
}

export function conditionMatches(config: JsonConfig, facts: FlowFacts) {
  if (config.field === "customer_replied") return facts.customerReplied;
  if (config.field === "opened_email") return facts.openedEmail;
  if (config.field === "clicked_link") return facts.clickedLink;
  if (config.field === "category_is") return normalized(config.category) === normalized(facts.category);
  return false;
}

function actionForCondition(config: JsonConfig, matched: boolean) {
  return String(matched ? config.action || "continue" : config.unmatchedAction || "continue");
}

export function simulateFlow(flow: FlowInput, facts: FlowFacts, from = new Date()) {
  const trace: SimulationEntry[] = [];
  let index = 0;
  while (index < flow.steps.length) {
    const step = flow.steps[index]!;
    if (step.type === "wait") {
      trace.push({ step: index + 1, type: step.type, status: "waiting", detail: `Would resume at ${calculateWaitUntil(step.config, from).toISOString()}` });
      index += 1;
      continue;
    }
    if (step.type === "if_condition") {
      const matched = conditionMatches(step.config, facts);
      const action = actionForCondition(step.config, matched);
      trace.push({ step: index + 1, type: step.type, status: "would_run", detail: `Condition ${matched ? "matched" : "did not match"}; ${action.replaceAll("_", " ")}` });
      if (action === "stop_flow") {
        trace.push({ step: index + 1, type: step.type, status: "stopped", detail: "Flow would end here." });
        break;
      }
      if (action === "skip_next" && flow.steps[index + 1]) {
        trace.push({ step: index + 2, type: flow.steps[index + 1]!.type, status: "skipped", detail: "Skipped by the preceding condition." });
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    trace.push({ step: index + 1, type: step.type, status: step.type === "stop" ? "stopped" : "would_run", detail: step.type === "stop" ? String(step.config.reason || "Flow would end here.") : `${step.type.replaceAll("_", " ")} is configured.` });
    if (step.type === "stop") break;
    index += 1;
  }
  return { ok: true, trace, terminal: trace.at(-1)?.status === "stopped" ? "stopped" : "complete" } as const;
}
