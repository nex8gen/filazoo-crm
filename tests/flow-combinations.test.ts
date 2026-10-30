import assert from "node:assert/strict";
import test from "node:test";
import { blankStep, cloneFlowStep, flowInputSchema, triggerTypes, type FlowInput, type JsonConfig } from "../lib/flows.ts";
import { flowStepAtPath, simulateFlow } from "../lib/flow-engine.ts";
import { editFlowSiblings, flowActionLocations, flowNodeWidth } from "../lib/flow-tree.ts";
import { testFlowScenarios } from "../lib/flow-scenarios.ts";
import { auditFlowDefinition } from "../lib/flow-audit.ts";
import { createFlowRecipe, flowRecipeOptions } from "../lib/flow-recipes.ts";

const email = () => ({ ...blankStep("send_email"), config: { ...blankStep("send_email").config, templateId: "welcome_intro", sendWindow: "anytime" } });
function split(match: FlowInput["steps"], fallback: FlowInput["steps"] = [], condition: JsonConfig = { field: "country_is", value: "US" }) {
  const action = blankStep("split");
  action.config.paths = [{ id: `${action.id}-yes`, name: "Match", condition, steps: match }, { id: `${action.id}-no`, name: "Other", condition: null, steps: fallback }] as unknown as JsonConfig["paths"];
  return action;
}
function flow(steps: FlowInput["steps"]): FlowInput { return { name: "Complex journey", triggerType: "new_lead", triggerConfig: {}, status: "draft", steps }; }
const facts = { customerReplied: false, openedEmail: false, clickedLink: false, category: null, country: "US", segment: null, companyStatus: "new", pipelineStage: "new", fitScore: 8 };

test("all trigger families validate nested splits with every action family", () => {
  for (const triggerType of triggerTypes.filter(type => type !== "pipeline_stage_changed")) {
    const triggerConfig = triggerType === "category_changed" ? { category: "Interested" } : triggerType === "no_reply" ? { amount: 1, unit: "hours" } : triggerType === "lead_added_to_list" ? { listId: "Shopify B2B leads" } : triggerType === "company_segment_changed" ? { segment: "Retail" } : triggerType === "pipeline_stage_changed" ? { stage: "new" } : {};
    const actions = [blankStep("wait"), email(), blankStep("ai_auto_reply"), blankStep("create_task"), blankStep("change_category"), blankStep("update_company"), blankStep("internal_alert"), blankStep("if_condition"), blankStep("stop")];
    const parsed = flowInputSchema.safeParse({ ...flow([split([split(actions)])]), triggerType, triggerConfig });
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.message);
  }
});

test("nested routes preserve source addresses, apply updated properties, and return through both joins", () => {
  const update = { ...blankStep("update_company"), config: { companyStatus: "qualified" } };
  const innerMail = email(), outerMail = email(), finalTask = blankStep("create_task");
  const definition = flow([split([update, split([innerMail], [blankStep("stop")], { field: "company_status_is", companyStatus: "qualified" }), outerMail]), finalTask]);
  const trace = simulateFlow(flowInputSchema.parse(definition), facts).trace;
  assert.equal(trace.filter((entry) => entry.type === "send_email").length, 2);
  assert.deepEqual(trace.find((entry) => entry.type === "send_email")?.stepPath, [0, 0, 1, 0, 0]);
  assert.equal(flowStepAtPath(definition, [0, 0, 1, 0, 0])?.id, innerMail.id);
  assert.equal(trace.at(-1)?.type, "create_task");
  assert.equal(flowStepAtPath(definition, [0, 0]), undefined);
});

test("deep editing and cloning isolate sibling branches and regenerate every identity", () => {
  const definition = flow([split([split([email()])], [email()])]);
  const before = JSON.stringify(definition);
  const path = [0, 0, 0, 0, 0];
  const edited = editFlowSiblings(definition.steps, path, (steps, index) => steps.map((action, i) => i === index ? { ...action, config: { ...action.config, subject: "Changed" } } : action));
  assert.equal(flowStepAtPath({ steps: edited }, path)?.config.subject, "Changed");
  assert.equal(JSON.stringify(definition), before);
  assert.equal(edited[0].config.paths === definition.steps[0].config.paths, false);
  const copy = cloneFlowStep(definition.steps[0]);
  assert.equal(flowInputSchema.safeParse(flow([definition.steps[0], copy])).success, true);
  assert.ok(flowNodeWidth(copy) > 1000);
});

test("tree validation bounds depth and action counts, catches repeated IDs and malformed children", () => {
  let action = email();
  for (let i = 0; i < 5; i++) action = split([action]);
  assert.equal(flowInputSchema.safeParse(flow([action])).success, true);
  assert.equal(flowInputSchema.safeParse(flow([split([action])])).success, false);
  const duplicate = email();
  assert.equal(flowInputSchema.safeParse(flow([split([duplicate], [duplicate])])).success, false);
  const wide = Array.from({ length: 20 }, () => split(Array.from({ length: 25 }, email)));
  assert.equal(flowInputSchema.safeParse(flow(wide)).success, false);
  const malformed = split([]); (malformed.config.paths as Array<JsonConfig>)[0].steps = [null];
  assert.equal(flowInputSchema.safeParse(flow([malformed])).success, false);
});

test("scenario coverage finds nested paths, missing values, reply stops and impossible ordered paths", () => {
  const definition = flow([split([split([email()], [blankStep("create_task")], { field: "fit_score_at_least", fitScore: 7 })], [blankStep("stop")])]);
  const report = testFlowScenarios(definition);
  assert.equal(report.reachedPaths, report.pathCount);
  assert.ok(report.cases.some((item) => item.facts.fitScore === null));
  assert.ok(report.cases.some((item) => item.trace.some((entry) => entry.status === "stopped" && entry.type === "send_email")));
  const impossible = split([email()]);
  (impossible.config.paths as Array<JsonConfig>).splice(1, 0, { id: "unreachable", name: "Shadowed US path", condition: { field: "country_is", value: "US" }, steps: [] });
  assert.ok(testFlowScenarios(flow([impossible])).uncoveredPaths.some((name) => name.endsWith("Shadowed US path")));
  assert.equal(flowActionLocations(definition.steps).length, report.actionCount);
});

test("every starter validates with fresh identities and generated scenarios cover engagement after waits", () => {
  for (const recipe of flowRecipeOptions) {
    const definition = createFlowRecipe(recipe.id);
    if (recipe.id === "segment") {
      assert.equal(flowInputSchema.safeParse(definition).success, false, "A segment must be explicitly selected before saving or launching.");
      definition.triggerConfig.segment = "Retail";
    }
    assert.equal(flowInputSchema.safeParse(definition).success, true, recipe.id);
    assert.equal(definition.status, "draft");
    assert.notEqual(definition.steps[0].id, createFlowRecipe(recipe.id).steps[0].id);
    const report = testFlowScenarios(definition);
    assert.equal(report.reachedPaths, report.pathCount, `${recipe.id}: ${report.uncoveredPaths.join(", ")}`);
  }
  const report = testFlowScenarios(createFlowRecipe("inbound"));
  assert.ok(report.cases.some((item) => item.afterWait?.facts.customerReplied && item.trace.some((entry) => entry.type === "stop")));
});

test("pacing audit checks branch interiors and shared continuation", () => {
  for (const steps of [[split([email(), email()])], [split([email()]), email()], [email(), blankStep("change_category"), email()]]) {
    assert.equal(auditFlowDefinition(flow(steps)).find((item) => item.id === "message-pacing")?.severity, "warning");
  }
  assert.equal(auditFlowDefinition(flow([split([email(), blankStep("wait")]), email()])).find((item) => item.id === "message-pacing")?.severity, "pass");
});

test("all ordered action pairs preserve branch isolation, source identity and chronological waits", () => {
  const types = ["wait", "split", "if_condition", "send_email", "ai_auto_reply", "create_task", "change_category", "update_company", "internal_alert", "stop"] as const;
  const make = (type: typeof types[number]) => type === "send_email" ? email() : type === "split" ? split([blankStep("create_task")], [blankStep("stop")]) : blankStep(type);
  let checked = 0;
  for (const first of types) for (const second of types) {
    const definition = flow([split([make(first), make(second)], [make(second), make(first)]), blankStep("create_task")]);
    const parsed = flowInputSchema.parse(definition);
    const before = JSON.stringify(parsed);
    for (const country of ["US", "GB", null]) for (const customerReplied of [false, true]) for (const openedEmail of [false, true]) for (const clickedLink of [false, true]) {
      const trace = simulateFlow(parsed, { ...facts, country, customerReplied, openedEmail, clickedLink }, new Date("2026-10-30T09:00:00Z")).trace;
      const addresses = trace.filter((entry) => entry.status !== "stopped").map((entry) => entry.stepPath!.join("."));
      assert.equal(new Set(addresses).size, addresses.length, `${first} -> ${second}: an action ran twice`);
      assert.ok(trace.every((entry) => flowStepAtPath(parsed, entry.stepPath!)?.type === entry.type));
      assert.ok(trace.every((entry) => entry.stepPath!.length === 1 || entry.stepPath![1] === (country === "US" ? 0 : 1)), "Unselected outer branch must never run");
      const dates = trace.flatMap((entry) => entry.scheduledAt ? [Date.parse(entry.scheduledAt)] : []);
      assert.ok(dates.every((date, index) => !index || date >= dates[index - 1]), "Scheduled actions cannot move backwards in time");
      const stop = trace.findIndex((entry) => entry.status === "stopped");
      assert.ok(stop < 0 || stop === trace.length - 1, "No action may run after an exit");
      assert.equal(JSON.stringify(parsed), before, "Testing must never mutate the definition");
      checked++;
    }
  }
  assert.equal(checked, 2400);
});
