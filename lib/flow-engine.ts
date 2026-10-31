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
  savedSegmentIds?: string[];
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
  occurredAt?: string;
};

export type SimulationEntry = {
  step: number;
  type: FlowStepType;
  status: "would_run" | "waiting" | "skipped" | "stopped";
  detail: string;
  scheduledAt?: string;
  /** Original definition address: root index, then (path index, action index) pairs. */
  stepPath?: number[];
  pathId?: string;
  pathChecks?: Array<{ name: string; matched: boolean | null }>;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function flowConversationPath(conversationId: string) {
  const company = /^company:([\da-f-]{36})(?::pipeline|:lead:[\da-f-]{36})?$/i.exec(conversationId);
  return company ? `/companies/${company[1]}` : `/emails?thread=${encodeURIComponent(conversationId)}`;
}

export function matchesProfileFilters(config: JsonConfig, facts: FlowFacts) {
  if (config.savedSegmentId && !facts.savedSegmentIds?.includes(String(config.savedSegmentId))) return false;
  if (!config.savedSegmentId && config.segment && normalized(config.segment) !== normalized(facts.segment)) return false;
  if (config.country && normalized(config.country) !== normalized(facts.country)) return false;
  if (config.companyStatus && config.companyStatus !== facts.companyStatus) return false;
  if (config.pipelineStage) return false;
  if (typeof config.minFitScore === "number" && (facts.fitScore ?? 0) < config.minFitScore) return false;
  return true;
}

export function matchesFlowCustomer(config: JsonConfig, contactId?: string | null) {
  if (config.flowScope === "email" && (!contactId || normalized(config.scopeContactId) !== normalized(contactId))) return false;
  // An absent selection preserves existing flows. An empty or malformed
  // selection must never broaden a restricted flow to everyone.
  if (!("contactIds" in config)) return true;
  return Array.isArray(config.contactIds) && Boolean(contactId)
    && config.contactIds.some((id) => normalized(id) === normalized(contactId));
}

export function matchesFlowScope(config: JsonConfig, companyId?: string | null, contactId?: string | null) {
  if (!config.flowScope) return !config.scopeCompanyId && !config.scopeContactId;
  if (!["email", "company"].includes(String(config.flowScope)) || !companyId || !config.scopeCompanyId) return false;
  return normalized(config.scopeCompanyId) === normalized(companyId)
    && (config.flowScope !== "email" || Boolean(contactId && config.scopeContactId && normalized(config.scopeContactId) === normalized(contactId)));
}

export function triggerMatches(type: TriggerType, config: JsonConfig, event: TriggerEvent, facts: FlowFacts) {
  if (event.type !== type || !matchesFlowScope(config, event.companyId, event.contactId) || !matchesFlowCustomer(config, event.contactId) || !matchesProfileFilters(config, facts)) return false;
  if (type === "category_changed") return normalized(config.category) === normalized(event.category);
  if (type === "lead_added_to_list") return normalized(config.listId) === normalized(event.listId);
  if (type === "company_segment_changed") return Boolean(config.savedSegmentId) || normalized(config.segment) === normalized(event.segment ?? facts.segment);
  if (type === "pipeline_stage_changed") return false;
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
  if (unit === "minutes" || unit === "hours") {
    let remaining = amount * (unit === "minutes" ? 60_000 : 3_600_000);
    if (config.businessDays) {
      moveOffWeekend(result);
      while (remaining > 0) {
        const midnight = new Date(result); midnight.setUTCHours(24, 0, 0, 0);
        const elapsed = Math.min(remaining, midnight.getTime() - result.getTime());
        result.setTime(result.getTime() + elapsed);
        remaining -= elapsed;
        if (isWeekend(result)) moveOffWeekend(result);
      }
    } else result.setTime(result.getTime() + remaining);
  }
  else if (config.businessDays) {
    let remaining = amount;
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() + 1);
      if (!isWeekend(result)) remaining -= 1;
    }
  } else result.setUTCDate(result.getUTCDate() + amount);

  if (config.businessDays && unit !== "days") moveOffWeekend(result);
  if (typeof config.resumeAt === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(config.resumeAt)) {
    const earliest = new Date(unit === "days" ? from : result);
    const [hours, minutes] = config.resumeAt.split(":").map(Number);
    result.setUTCHours(hours, minutes, 0, 0);
    if (result < earliest) result.setUTCDate(result.getUTCDate() + 1);
    if (config.businessDays) moveOffWeekend(result);
  }
  return result;
}

export function nextBusinessWindow(now = new Date()) {
  const next = new Date(now);
  const hour = next.getUTCHours();
  if (!isWeekend(next) && hour >= 9 && hour < 17) return null;
  if (hour >= 17) next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(9, 0, 0, 0);
  return moveOffWeekend(next);
}

export function conditionMatches(config: JsonConfig, facts: FlowFacts): boolean {
  if (Array.isArray(config.rules)) {
    const rules = config.rules.filter((rule): rule is JsonConfig => Boolean(rule && typeof rule === "object" && !Array.isArray(rule)));
    if (!rules.length) return false;
    return config.match === "any" ? rules.some((rule) => conditionMatches(rule, facts)) : rules.every((rule) => conditionMatches(rule, facts));
  }
  let actual: string | number | boolean | null, expected: string | number | boolean | null;
  switch (config.field) {
    case "customer_replied": actual = facts.customerReplied; expected = true; break;
    case "opened_email": actual = facts.openedEmail; expected = true; break;
    case "clicked_link": actual = facts.clickedLink; expected = true; break;
    case "category_is": actual = facts.category; expected = String(config.category ?? ""); break;
    case "company_status_is": actual = facts.companyStatus; expected = String(config.companyStatus ?? ""); break;
    case "pipeline_stage_is": return false;
    case "segment_is": actual = facts.segment; expected = String(config.value ?? ""); break;
    case "country_is": actual = facts.country; expected = String(config.value ?? ""); break;
    case "fit_score_at_least": actual = facts.fitScore; expected = Number(config.fitScore ?? 0); break;
    default: return false;
  }
  const operator = String(config.operator || (config.field === "fit_score_at_least" ? "gte" : "equals"));
  const left = normalized(actual), right = normalized(expected);
  let matched = false;
  if (operator === "is_set") matched = actual !== null && actual !== "";
  else if (operator === "is_not_set") matched = actual === null || actual === "";
  else if (operator === "not_equals") matched = left !== right;
  else if (operator === "contains") matched = left.includes(right);
  else if (operator === "not_contains") matched = !left.includes(right);
  else if (operator === "starts_with") matched = left.startsWith(right);
  else if (operator === "ends_with") matched = left.endsWith(right);
  else if (["gte", "gt", "lte", "lt"].includes(operator)) {
    if (actual !== null) matched = operator === "gte" ? Number(actual) >= Number(expected) : operator === "gt" ? Number(actual) > Number(expected) : operator === "lte" ? Number(actual) <= Number(expected) : Number(actual) < Number(expected);
  } else matched = left === right;
  return config.negate ? !matched : matched;
}

export function flowStepAtPath(flow: Pick<FlowInput, "steps">, path: number[]) {
  if (!path.length || path.length % 2 !== 1 || path.some((index) => !Number.isInteger(index) || index < 0)) return undefined;
  let step: FlowInput["steps"][number] | undefined = flow.steps[path[0]];
  for (let index = 1; step && index < path.length; index += 2) {
    if (step.type !== "split") return undefined;
    const branches = Array.isArray(step.config.paths) ? step.config.paths : [];
    const branch = branches[path[index]];
    if (!branch || typeof branch !== "object" || Array.isArray(branch) || !Array.isArray(branch.steps)) return undefined;
    step = branch.steps[path[index + 1]] as FlowInput["steps"][number] | undefined;
  }
  return step;
}

export function allFlowActions(steps: FlowInput["steps"]): FlowInput["steps"] {
  return steps.flatMap((step) => {
    if (step.type !== "split" || !Array.isArray(step.config.paths)) return [step];
    const nested = step.config.paths.flatMap((path) => path && typeof path === "object" && !Array.isArray(path) && Array.isArray(path.steps) ? path.steps : []) as FlowInput["steps"];
    return [step, ...allFlowActions(nested)];
  });
}

function actionForCondition(config: JsonConfig, matched: boolean) {
  return String(matched ? config.action || "continue" : config.unmatchedAction || "continue");
}

export function simulateFlow(flow: FlowInput, facts: FlowFacts, from = new Date(), scenario: { afterWait?: { number: number; facts: Partial<FlowFacts> } } = {}) {
  const trace: SimulationEntry[] = [];
  const currentFacts = { ...facts };
  let cursor = new Date(from);
  let index = 0;
  let waitsReached = 0;
  const steps = flow.steps.map((step, index) => ({ step, path: [index] }));
  while (index < steps.length) {
    const { step, path } = steps[index]!;
    const push = (entry: SimulationEntry) => trace.push({ stepPath: path, ...entry });
    if (step.type === "split") {
      const paths = Array.isArray(step.config.paths) ? step.config.paths : [];
      const selected = paths.find((path) => path && typeof path === "object" && !Array.isArray(path) && path.condition && typeof path.condition === "object" && !Array.isArray(path.condition) && conditionMatches(path.condition as JsonConfig, currentFacts))
        ?? paths.find((path) => path && typeof path === "object" && !Array.isArray(path) && path.condition === null);
      const selectedPath = selected && typeof selected === "object" && !Array.isArray(selected) ? selected : null;
      const nested = selectedPath && Array.isArray(selectedPath.steps) ? selectedPath.steps as FlowInput["steps"] : [];
      const selectedIndex = paths.indexOf(selected!);
      const pathChecks = paths.map((item, pathIndex) => {
        const candidate = item && typeof item === "object" && !Array.isArray(item) ? item : {};
        return { name: String(candidate.name || "Path"), matched: pathIndex > selectedIndex ? null : pathIndex === selectedIndex };
      });
      push({ step: index + 1, type: step.type, status: "would_run", pathId: String(selectedPath?.id || ""), pathChecks, detail: `Would enter ${String(selectedPath?.name || "Everyone else")}` });
      steps.splice(index, 1, ...nested.map((action, actionIndex) => ({ step: action, path: [...path, paths.indexOf(selected!), actionIndex] })));
      continue;
    }
    if (step.type === "wait") {
      cursor = calculateWaitUntil(step.config, cursor);
      push({ step: index + 1, type: step.type, status: "waiting", scheduledAt: cursor.toISOString(), detail: `Would resume at ${cursor.toISOString()}` });
      waitsReached++;
      if (scenario.afterWait?.number === waitsReached) Object.assign(currentFacts, scenario.afterWait.facts);
      index += 1;
      continue;
    }
    if (step.type === "if_condition") {
      const matched = conditionMatches(step.config, currentFacts);
      const action = actionForCondition(step.config, matched);
      push({ step: index + 1, type: step.type, status: "would_run", detail: `Condition ${matched ? "matched" : "did not match"}; ${action.replaceAll("_", " ")}` });
      if (action === "stop_flow") {
        push({ step: index + 1, type: step.type, status: "stopped", detail: "Flow would end here." });
        break;
      }
      if (action === "skip_next" && steps[index + 1]) {
        push({ step: index + 2, type: steps[index + 1]!.step.type, status: "skipped", detail: "Skipped by the preceding condition.", stepPath: steps[index + 1]!.path });
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (["send_email", "ai_auto_reply"].includes(step.type) && (!matchesProfileFilters(flow.triggerConfig, currentFacts) || (step.config.filters && !conditionMatches(step.config.filters as JsonConfig, currentFacts)))) {
      push({ step: index + 1, type: step.type, status: "skipped", detail: "Message filters did not match; continues to the next action." });
      index += 1;
      continue;
    }
    if (step.type === "change_category") currentFacts.category = String(step.config.category);
    if (step.type === "update_company") {
      if (step.config.companyStatus) currentFacts.companyStatus = String(step.config.companyStatus);
      if (step.config.segment) currentFacts.segment = String(step.config.segment);
    }
    if (step.type === "ai_auto_reply") {
      if (step.config.sendWindow === "business_hours") cursor = nextBusinessWindow(cursor) ?? cursor;
      push({ step: index + 1, type: step.type, status: "would_run", scheduledAt: cursor.toISOString(), detail: `Would read the latest email and draft a personalized English reply${step.config.useProducts ? " using active CRM products" : ""}${step.config.usePrices ? " and verified prices" : ""}${step.config.attachCatalog ? "; attach a matching-product catalog PDF when requested or clearly needed" + (step.config.catalogFirstMessageOnly !== false ? ", also on the first automated email" : "") : ""}. No AI request or email is sent in simulation.` });
      index += 1;
      continue;
    }
    if (step.type === "send_email" && step.config.stopOnReply !== false && currentFacts.customerReplied) {
      push({ step: index + 1, type: step.type, status: "stopped", detail: "Customer replied; run would be cancelled." });
      break;
    }
    if (step.type === "send_email" && step.config.sendWindow === "business_hours") cursor = nextBusinessWindow(cursor) ?? cursor;
    const detail = step.type === "stop" ? String(step.config.reason || "Flow would end here.")
      : step.type === "create_task" ? `Would create “${String(step.config.title)}”; due in ${Number(step.config.dueInDays || 0)} days.`
      : step.type === "change_category" ? `Would set the email category to ${String(step.config.category)}.`
      : step.type === "update_company" ? `Would update ${[step.config.companyStatus && `status: ${step.config.companyStatus}`, step.config.segment && `segment: ${step.config.segment}`].filter(Boolean).join(", ")}.`
      : step.type === "internal_alert" ? `Would send an ${step.config.channel === "email" ? "email" : "in-app"} alert: ${String(step.config.message)}`
      : step.type === "send_email" ? `Would send ${String(step.config.subject || step.config.templateId || "email")}${step.config.replyInThread ? " in the same thread" : " as a new thread"}.`
      : "Action configured.";
    push({ step: index + 1, type: step.type, status: step.type === "stop" ? "stopped" : "would_run", scheduledAt: cursor.toISOString(), detail });
    if (step.type === "stop") break;
    index += 1;
  }
  return { ok: true, trace, terminal: trace.at(-1)?.status === "stopped" ? "stopped" : "complete" } as const;
}
