import { simulateFlow, matchesProfileFilters, type FlowFacts } from "./flow-engine.ts";
import { flowActionLocations, flowPaths } from "./flow-tree.ts";
import { flowInputSchema, type FlowInput, type JsonConfig } from "./flows.ts";

const fields: Record<string, keyof FlowFacts> = { country_is: "country", segment_is: "segment", category_is: "category", company_status_is: "companyStatus", pipeline_stage_is: "pipelineStage", fit_score_at_least: "fitScore", customer_replied: "customerReplied", opened_email: "openedEmail", clicked_link: "clickedLink" };
const baseFacts: FlowFacts = { customerReplied: false, openedEmail: false, clickedLink: false, category: null, segment: null, country: null, companyStatus: null, pipelineStage: null, fitScore: null };

/** Bounded, deterministic condition coverage. This is a simulation, never a delivery test. */
export function testFlowScenarios(input: FlowInput, limit = 256, now = new Date()) {
  const parsed = flowInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Complete the flow settings first.");
  const flow = parsed.data;
  const domains = new Map<keyof FlowFacts, Set<string | number | boolean | null>>();
  const add = (field: keyof FlowFacts, values: Array<string | number | boolean | null>) => {
    const domain = domains.get(field) ?? new Set([baseFacts[field] ?? null]);
    values.forEach((value) => domain.add(value)); domains.set(field, domain);
  };
  function rule(config: JsonConfig) {
    if (Array.isArray(config.rules)) { config.rules.forEach((item) => { if (item && typeof item === "object" && !Array.isArray(item)) rule(item); }); return; }
    const field = fields[String(config.field)];
    if (!field) return;
    if (["customerReplied", "openedEmail", "clickedLink"].includes(field)) add(field, [false, true]);
    else if (field === "fitScore") { const value = Number(config.fitScore ?? 5); add(field, [null, 0, Math.max(0, value - 1), value, Math.min(10, value + 1), 10]); }
    else add(field, [null, String(config.category ?? config.companyStatus ?? config.pipelineStage ?? config.value ?? ""), "Other"]);
  }
  const actions = flowActionLocations(flow.steps);
  for (const { action } of actions) {
    if (action.type === "split") flowPaths(action.config).forEach((path) => { if (path.condition) rule(path.condition); });
    if (action.type === "if_condition") rule(action.config);
    if (action.config.filters && typeof action.config.filters === "object" && !Array.isArray(action.config.filters)) rule(action.config.filters);
    if (action.type === "send_email") add("customerReplied", [false, true]);
  }
  const baseline = { ...baseFacts };
  for (const key of ["country", "segment", "category", "companyStatus", "pipelineStage"] as const) if (typeof flow.triggerConfig[key] === "string") baseline[key] = flow.triggerConfig[key] as string;
  if (typeof flow.triggerConfig.minFitScore === "number") baseline.fitScore = flow.triggerConfig.minFitScore;
  let combinations: FlowFacts[] = [baseline];
  let possible = 1;
  for (const [field, values] of domains) {
    values.add(baseline[field] ?? null);
    possible *= values.size;
    combinations = combinations.flatMap((facts) => [...values].map((value) => ({ ...facts, [field]: value }))).slice(0, limit);
  }
  const engagementFields = (["customerReplied", "openedEmail", "clickedLink"] as const).filter((field) => domains.has(field));
  const transitions: Array<{ number: number; facts: Partial<FlowFacts> } | undefined> = [undefined];
  const waitCount = actions.filter(({ action }) => action.type === "wait").length;
  const engagementVariants = 2 ** engagementFields.length - 1;
  for (let number = 1; number <= waitCount && transitions.length < limit; number++) {
    for (let mask = 1; mask <= engagementVariants; mask++) transitions.push({ number, facts: Object.fromEntries(engagementFields.filter((_, index) => mask & (1 << index)).map((field) => [field, true])) });
  }
  possible *= 1 + waitCount * engagementVariants;
  const scenarios = transitions.flatMap((afterWait) => combinations.map((facts) => ({ facts, afterWait }))).slice(0, limit);
  const reached = new Set<string>();
  const paths = new Set<string>();
  const cases = scenarios.map(({ facts, afterWait }, index) => {
    const enters = matchesProfileFilters(flow.triggerConfig, facts);
    const trace = enters ? simulateFlow(flow, facts, now, { afterWait }).trace : [];
    trace.forEach((entry) => {
      if (entry.stepPath && entry.status !== "skipped") reached.add(entry.stepPath.join("."));
      if (entry.pathId) paths.add(entry.pathId);
    });
    return { id: index + 1, facts, afterWait, enters, trace };
  });
  const allPaths = actions.flatMap(({ action }) => action.type === "split" ? flowPaths(action.config).map((path) => ({ ...path, name: `${String(action.config.name || "Split")} / ${path.name}` })) : []);
  return { cases, possible, truncated: possible > limit, actionCount: actions.length, reachedActions: reached.size, pathCount: allPaths.length, reachedPaths: paths.size,
    uncoveredPaths: allPaths.filter((path) => !paths.has(path.id)).map((path) => path.name) };
}
