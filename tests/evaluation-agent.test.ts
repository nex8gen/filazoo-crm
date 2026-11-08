import test from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { evaluationCases, checkEvaluation, includesExpected } from "../scripts/agent-evaluation-cases.ts";
import { agentCapabilities } from "../lib/ai/capabilities.ts";
import { generateCrmPlan } from "../lib/ai/native-agent.ts";
import { conversationMemory } from "../lib/ai/chat-history.ts";
import type { WorkspaceAction } from "../lib/ai/workspace-assistant.ts";

const result = (toolName: string, input: unknown): LanguageModelV4GenerateResult => ({ content: [{ type: "tool-call", toolName, toolCallId: crypto.randomUUID(), input: JSON.stringify(input) }], finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } }, warnings: [] });
const scenarios = evaluationCases();
test("live scenarios cover every registered capability and use valid action schemas", () => {
  assert.deepEqual(scenarios.filter(value => value.expectedTool).map(value => value.expectedTool).sort(), agentCapabilities().map(value => value.name).sort());
  assert.equal(new Set(scenarios.map(value => value.name)).size, scenarios.length);
  assert.ok(scenarios.some(value => value.kind === "long-conversation" && value.messages.length > 100));
});
for (const scenario of scenarios.filter(value => value.expectedTool)) {
  const expected = scenario.expected as WorkspaceAction;
  const input = expected.type === "crm_action" ? expected.operation : expected;
  for (const denied of [false, true]) test(`${scenario.expectedTool}: native SDK ${denied ? "blocks denied" : "stages valid"} action without execution`, async () => {
    const model = new MockLanguageModelV4({ doGenerate: [result("discover_capabilities", { domain: scenario.domain }), result(scenario.expectedTool!, input), result(scenario.expectedTool!, input), result(scenario.expectedTool!, input)] });
    const plan = await generateCrmPlan({ model, prompt: scenario.messages[0].content, messages: scenario.messages, pathname: "/companies", language: "en", read: async () => ({ records: [] }), searchEmails: async () => ({ records: [] }), validateAction: () => { if (denied) throw new Error("Denied"); } });
    if (denied) assert.equal(plan.actions.length, 0);
    else { assert.deepEqual(checkEvaluation(plan, scenario), []); assert.equal(plan.actions.length, 1); }
  });
}
test("long conversation evaluation follows the production bounded history path and retains latest corrections", () => {
  for (const scenario of scenarios.filter(value => value.kind === "long-conversation")) {
    const memory = conversationMemory(scenario.messages);
    assert.equal(memory.messages.length, 10); assert.ok(memory.summary.length <= 5000);
    assert.equal(memory.messages.at(-1)?.content, scenario.messages.at(-1)?.content);
  }
});
test("evaluation checker rejects extra actions, swapped documents, changed quantities and premature completion claims", () => {
  const scenario = scenarios.find(value => value.name === "money:invoice")!;
  const action = scenario.expected as WorkspaceAction;
  const base = { output: "Ready for review.", actions: [action], contractVersion: "synthetic" };
  assert.deepEqual(checkEvaluation(base, scenario), []);
  assert.ok(checkEvaluation({ ...base, actions: [action, action] }, scenario).length);
  assert.ok(checkEvaluation({ ...base, output: "I have sent it." }, scenario).length);
  assert.ok(checkEvaluation({ ...base, actions: [] }, scenario).length);
  assert.equal(includesExpected({ items: [{ quantity: 501 }] }, { items: [{ quantity: 500 }] }), false);
});

test("explicit administrator actions stage mandatory review without a second chat authorization", async () => {
  const scenario = scenarios.find(value => value.name === "capability:delete_company")!;
  const action = scenario.expected as WorkspaceAction;
  assert.equal(action.type, "crm_action"); if (action.type !== "crm_action") return;
  const model = new MockLanguageModelV4({ doGenerate: result("delete_company", action.operation) });
  const plan = await generateCrmPlan({ model, prompt: scenario.messages[0].content, messages: scenario.messages, pathname: "/companies", language: "en", read: async () => ({ records: [] }), searchEmails: async () => ({ records: [] }), validateAction: () => {} });
  assert.equal(plan.actions.length, 1);
  const instructions = JSON.stringify(model.doGenerateCalls[0].prompt);
  assert.match(instructions, /mandatory CRM review/); assert.match(instructions, /never bypass server validation or review/);
});
test("evaluation diagnostics preserve schema failures while the runtime discards invalid proposals", async () => {
  const scenario = scenarios.find(value => value.name === "capability:create_quotation")!;
  const model = new MockLanguageModelV4({ doGenerate: result("create_quotation", { op: "create_quotation", companyId: "invented" }) });
  const diagnostics: Array<{ kind: string; tools: string[]; message?: string }> = [];
  const plan = await generateCrmPlan({ model, prompt: scenario.messages[0].content, messages: scenario.messages, pathname: "/companies", language: "en", read: async () => ({ records: [] }), searchEmails: async () => ({ records: [] }), validateAction: () => {}, onDiagnostic: event => { diagnostics.push(event); } });
  assert.equal(plan.actions.length, 0); assert.ok(diagnostics.some(value => value.kind === "tool-error" && value.tools.includes("create_quotation")));
});
test("a mixed batch receives explicit discarded-proposal feedback before a fresh separate action can succeed", async () => {
  const scenario = scenarios.find(value => value.name === "capability:create_quotation")!;
  const action = scenario.expected as WorkspaceAction;
  if (action.type !== "crm_action") throw new Error("Wrong fixture");
  const mixed = result("create_quotation", action.operation);
  mixed.content.push(...result("read_records", { resource: "products", query: "PLA" }).content);
  const model = new MockLanguageModelV4({ doGenerate: [mixed, result("create_quotation", action.operation)] });
  const plan = await generateCrmPlan({ model, prompt: scenario.messages[0].content, messages: scenario.messages, pathname: "/companies", language: "en", read: async () => ({ records: [] }), searchEmails: async () => ({ records: [] }), validateAction: () => {} });
  assert.equal(plan.actions.length, 1); assert.equal(model.doGenerateCalls.length, 2);
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /previous proposal batch was discarded/);
});
