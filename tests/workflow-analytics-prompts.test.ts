import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { workflowAnalyticsPrompts } from "../lib/flow-analytics-prompts.ts";
import { getPageAiPrompts } from "../lib/page-ai-prompts.ts";
import { assistantRecordScope, readAssistantPageContext } from "../lib/ai/page-context.ts";
import { conversationScope, savedPageContext } from "../lib/ai/chat-history.ts";
import { agentFlowAnalyticsReport, flowAnalyticsContextSchema } from "../lib/ai/flow-analytics-context.ts";
import { emptyFlowAnalyticsCounts, type FlowAnalyticsReport } from "../lib/flow-analytics.ts";
import { agentCapabilities } from "../lib/ai/capabilities.ts";

const id = "15693adc-0bdf-4617-b214-71b1861764a9";
const scope = flowAnalyticsContextSchema.parse({ range: "7", query: "Lead", status: "live", flowId: id, metric: "failed" });
function report(): FlowAnalyticsReport {
  return { range: "7", asOf: "2026-11-18T08:00:00Z", from: "2026-11-12T00:00:00Z", bucket: "day", series: {}, rows: [
    { ...emptyFlowAnalyticsCounts(), id, name: "Lead reply", status: "live", sent: 11, failed: 2, blocked: 1, latestIssue: "Reconnect sender", lastActivity: null },
    { ...emptyFlowAnalyticsCounts(), id: "15693adc-0bdf-4617-b214-71b1861764aa", name: "Other flow", status: "draft", sent: 99, latestIssue: null, lastActivity: null },
  ] };
}

test("workflow analytics has its own feature-grounded prompt set and executable action capabilities", () => {
  assert.equal(getPageAiPrompts("/workflow/analytics?range=7").page, "Workflow analytics");
  assert.deepEqual(getPageAiPrompts("/workflow/analytics").prompts, workflowAnalyticsPrompts);
  assert.equal(getPageAiPrompts("/workflow").page, "Workflow");
  assert.equal(workflowAnalyticsPrompts.length, 5);
  assert.equal(workflowAnalyticsPrompts.filter(prompt => prompt.mode === "chat").length, 2);
  for (const prompt of workflowAnalyticsPrompts) {
    assert.ok(prompt.description.length > 10 && prompt.prompt.length < 2000);
    if (prompt.mode === "chat") assert.match(prompt.prompt, /Read-only/);
    else assert.match(prompt.prompt, /executable proposals/i);
  }
  const capabilities = agentCapabilities();
  for (const name of ["duplicate_flow", "update_flow", "create_task", "run_workflow"]) assert.ok(capabilities.some(item => item.name === name));
  assert.equal(capabilities.find(item => item.name === "duplicate_flow")!.action({ flowId: id, name: "Lead reply improvement draft" }).type, "crm_action");
  assert.equal(capabilities.find(item => item.name === "create_task")!.action({ title: "Reconnect Lead reply sender", notes: `/workflow?flow=${id}`, priority: "high", dueAt: null }).type, "crm_action");
});

test("analytics context retains only validated visible filters and keeps histories scoped to those filters", () => {
  const page = { querySelectorAll(selector: string) { return selector === "[data-ai-flow-analytics]" ? [
    { checkVisibility: () => false, getAttribute: () => JSON.stringify({ ...scope, range: "all" }) },
    { checkVisibility: () => true, getAttribute: () => JSON.stringify(scope) },
  ] : []; } } as unknown as ParentNode;
  const context = readAssistantPageContext(page);
  assert.deepEqual(context.flowAnalytics, scope);
  assert.deepEqual(savedPageContext(context).flowAnalytics, scope);
  const different = { ...context, flowAnalytics: { ...scope, range: "30" as const } };
  assert.notEqual(assistantRecordScope(context), assistantRecordScope(different));
  assert.notEqual(conversationScope({ mode: "chat", pathname: "/workflow/analytics", pageContext: context }), conversationScope({ mode: "chat", pathname: "/workflow/analytics", pageContext: different }));
  assert.equal(flowAnalyticsContextSchema.safeParse({ ...scope, totals: { sent: 999999 } }).success, false);
  assert.equal(flowAnalyticsContextSchema.safeParse({ ...scope, flowId: "other-workspace" }).success, false);
});

test("trusted report filtering preserves selected scope and distinguishes bounded coverage from all totals", () => {
  const data = report();
  const result = agentFlowAnalyticsReport(data, scope);
  assert.equal(result.totals.sent, 11);
  assert.equal(result.workflows.length, 1);
  assert.equal(result.workflows[0].url, `/workflow?flow=${id}`);
  assert.equal(result.coverage.omitted, 0);
  data.rows = Array.from({ length: 80 }, (_, index) => ({ ...data.rows[0], id: `flow-${index}`, sent: 1 }));
  const bounded = agentFlowAnalyticsReport(data, flowAnalyticsContextSchema.parse({ range: "7" }));
  assert.equal(bounded.totals.sent, 80);
  assert.equal(bounded.coverage.included, 50);
  assert.equal(bounded.coverage.omitted, 30);
});

test("agent analytics reload checks AI access before reading and never accepts browser metric facts", async () => {
  let allowed = true, reads = 0;
  const exports = {} as { loadAgentWorkflowAnalytics: (scope: unknown) => Promise<ReturnType<typeof agentFlowAnalyticsReport>> };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../data/ai-settings": { requireAiData: async (...resources: string[]) => { assert.deepEqual(resources, ["flows", "emails", "team"]); if (!allowed) throw new Error("AI access disabled"); } },
    "../data/flow-analytics": { getFlowAnalytics: async (range: string) => { reads++; assert.equal(range, "7"); return { report: report() }; } },
    "./flow-analytics-context.ts": { agentFlowAnalyticsReport, flowAnalyticsContextSchema },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/ai/agent-flow-analytics.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  assert.equal((await exports.loadAgentWorkflowAnalytics(scope)).totals.sent, 11);
  assert.equal(reads, 1);
  await assert.rejects(() => exports.loadAgentWorkflowAnalytics({ ...scope, totals: { sent: 999999 } }));
  assert.equal(reads, 1);
  allowed = false;
  await assert.rejects(() => exports.loadAgentWorkflowAnalytics(scope), /AI access disabled/);
  assert.equal(reads, 1);
});

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

test("ideas expand and collapse, launch the correct modes once, and hide action prompts for viewers", () => {
  let expanded = false;
  const launches: unknown[] = [];
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    react: { useId: () => "ideas", useState: () => [expanded, (update: (value: boolean) => boolean) => { expanded = update(expanded); }] },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@/components/language-provider": { useLanguage: () => ({ t: (value: string) => value }) },
    "@/lib/flow-analytics-prompts": { workflowAnalyticsPrompts },
    "@/lib/ai/launch": { launchWorkspaceAi: (value: unknown) => launches.push(value) },
  };
  const exports = {} as { WorkflowAnalyticsIdeas: (props: { canEdit: boolean }) => Element };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/workflow-analytics-ideas.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: (name: string) => dependencies[name] ?? new Proxy({}, { get: (_target, key) => String(key) }),
  });
  let tree = exports.WorkflowAnalyticsIdeas({ canEdit: true });
  const toggle = (value: Element) => elements(value).find(item => item.props["aria-controls"] === "ideas")!;
  assert.equal(toggle(tree).props["aria-expanded"], false);
  (toggle(tree).props.onClick as () => void)();
  tree = exports.WorkflowAnalyticsIdeas({ canEdit: true });
  assert.equal(toggle(tree).props["aria-expanded"], true);
  const buttons = elements(tree).filter(item => item.props.className === "workflow-analytics-idea");
  assert.equal(buttons.length, 5);
  buttons.forEach((button, index) => {
    (button.props.onClick as () => void)();
    assert.deepEqual(JSON.parse(JSON.stringify(launches[index])), { mode: workflowAnalyticsPrompts[index].mode, prompt: workflowAnalyticsPrompts[index].prompt, submit: true });
  });
  assert.equal(launches.length, 5);
  (toggle(tree).props.onClick as () => void)();
  assert.equal(toggle(exports.WorkflowAnalyticsIdeas({ canEdit: true })).props["aria-expanded"], false);
  assert.equal(elements(exports.WorkflowAnalyticsIdeas({ canEdit: false })).filter(item => item.props.className === "workflow-analytics-idea").length, 2);
});
