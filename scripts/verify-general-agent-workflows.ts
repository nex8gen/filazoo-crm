import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { agentCapabilities } from "../lib/ai/capabilities.ts";
import { resolveWorkflowInput, validateWorkflowGraph } from "../lib/ai/workflow-schema.ts";
import { defaultFlowInput } from "../lib/flows.ts";

const companyId = "15693adc-0bdf-4617-b214-71b1861764a9";
const cases = [
  { name: "new-customer-and-task", text: "Create a new company called Synthetic Aster Printing in the United States, segment 3D printing, contact buyer@example.com, then create a high-priority follow-up task for THAT NEW company to review samples.", tools: ["create_company", "create_task"], result: "companyId" },
  { name: "existing-customer-task-and-note", text: "For the existing Synthetic Printing customer, create a task to review their Black PLA samples and add the note 'Requested sample review' to that customer's profile.", tools: ["create_task", "add_company_note"] },
  { name: "new-flow-and-status", text: "Create a NEW automation flow named Synthetic Sample Follow-up using the provided flowTemplate, then pause THAT NEW flow. Do not modify an existing flow or send any email.", tools: ["create_flow", "flow_status"], result: "flowId" },
];
if (!process.argv.includes("--live")) { console.log(JSON.stringify({ cases: cases.map(value => value.name), syntheticOnly: true, businessWrites: false, maximumProviderCallsPerCase: 6 })); process.exit(0); }
const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
if (!token) throw new Error("A configured model provider is required.");
const results: Array<Record<string, unknown>> = [];
for (const scenario of cases.filter(value => !process.argv.includes("--case") || process.argv[process.argv.indexOf("--case") + 1] === value.name)) {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => { if (++calls > 6) throw new Error("Synthetic provider call limit reached."); return fetch(url, init); };
  const messages = [{ role: "user", content: scenario.text }];
  const customer = { id: companyId, name: "Synthetic Printing", fields: { name: "Synthetic Printing", contactEmail: "existing@example.com" } };
  const data = { currentCompanyId: companyId, currentCompany: customer, flowTemplate: defaultFlowInput };
  const diagnostics: Array<{ tools: string[]; message?: string }> = [];
  try {
    const models = await nativeGatewayModels({ token: token!, userId: companyId, userText: scenario.text, fetcher });
    const plan = await generateCrmPlan({ ...models, prompt: JSON.stringify({ CONVERSATION: messages, SERVER_DATA: data }), messages, pathname: "/analytics", language: "en", signal: AbortSignal.timeout(60_000),
      onDiagnostic: event => { if (event.kind === "tool-error") diagnostics.push({ tools: event.tools, message: event.message }); },
      read: async () => ({ records: [customer], coverage: { included: 1, nextOffset: null } }), searchEmails: async () => ({ records: [], coverage: { included: 0, nextOffset: null } }),
      validateAction: action => {
        if (action.type !== "run_workflow") throw new Error("This request includes multiple actions. Compose every requested step in one run_workflow.");
        validateWorkflowGraph(action.steps);
        for (const step of action.steps) {
          const capability = agentCapabilities().find(value => value.name === step.tool);
          assert.ok(capability && step.tool !== "run_workflow");
          capability.action(resolveWorkflowInput(step, {}, true));
        }
      },
    });
    assert.equal(plan.actions.length, 1);
    const workflow = plan.actions[0]; assert.equal(workflow.type, "run_workflow");
    if (workflow.type !== "run_workflow") throw new Error("A connected workflow was not returned.");
    assert.deepEqual([...workflow.steps.map(step => step.tool)].sort(), [...scenario.tools].sort());
    if (scenario.result) assert.ok(workflow.steps.some(step => step.bindings.some(binding => binding.result === scenario.result)));
    results.push({ name: scenario.name, passed: true, providerCalls: calls, contractVersion: plan.contractVersion, workflow });
  } catch (error) { results.push({ name: scenario.name, passed: false, providerCalls: calls, error: error instanceof Error ? error.message.slice(0, 350) : "Verification failed", diagnostics }); }
  console.log(JSON.stringify({ name: scenario.name, passed: results.at(-1)!.passed, providerCalls: calls, ...(results.at(-1)!.error ? { error: results.at(-1)!.error } : {}) }));
}
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/general-agent-workflows-20261107.json", JSON.stringify({ syntheticOnly: true, businessWrites: false, provider: "vercel-ai-gateway", results }, null, 2) + "\n");
if (results.some(value => !value.passed)) process.exitCode = 1;
