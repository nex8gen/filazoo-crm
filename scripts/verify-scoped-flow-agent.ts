// Live model planning only: synthetic identity, no database, SMTP or execution.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { resolveGatewayToken } from "../lib/ai/provider-credentials.ts";
import { defaultFlowInput, blankStep } from "../lib/flows.ts";

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ provider: "vercel-ai-gateway", syntheticOnly: true, businessWrites: false, maximumCalls: 6 }));
  process.exit(0);
}
const token = resolveGatewayToken();
if (!token) throw new Error("Vercel AI Gateway authentication is required.");
const id = "3f6d1d45-2834-4ac3-b5f6-8460e6cf051f";
const saved = { ...defaultFlowInput, id, name: "Synthetic buyer — AI reply after 5 min", status: "draft", triggerType: "email_received", triggerConfig: { flowScope: "email", scopeLabel: "buyer@example.com", scopeCompanyId: "11111111-1111-4111-8111-111111111111", scopeContactId: "22222222-2222-4222-8222-222222222222", reentryMode: "every_event" }, steps: [{ ...blankStep("wait"), config: { amount: 5, unit: "minutes" } }, blankStep("ai_auto_reply")] };
const text = "no need to make it draft make it live and show that in the workflow list";
const messages = [
  { role: "user", content: "Create a workflow only for buyer@example.com: if they send or reply to an email, send an AI reply after 5 minutes." },
  { role: "assistant", content: `Created ${saved.name} as a draft workflow. Saved flow ID ${id}.` },
  { role: "user", content: text },
];
let calls = 0, reads = 0;
const fetcher: typeof fetch = async (url, init) => { if (++calls > 6) throw new Error("Synthetic verification call limit reached."); return fetch(url, init); };
const models = await nativeGatewayModels({ token, userId: "11111111-1111-4111-8111-111111111111", userText: text, fetcher });
const plan = await generateCrmPlan({ ...models, messages, pathname: "/companies", language: "en", signal: AbortSignal.timeout(60_000),
  prompt: JSON.stringify({ CONVERSATION: messages, SERVER_DATA: { flowResources: { recentFlows: [saved] }, EXECUTION_RESULTS: [{ status: "completed", result: { flowId: id, success: `${saved.name} created as a draft workflow.` } }] } }),
  read: async () => { reads++; return { records: [saved], coverage: { matching: 1, included: 1, nextOffset: null } }; }, searchEmails: async () => ({ records: [] }),
  validateAction: action => { assert.equal(action.type, "crm_action", "Update the existing flow; do not create a replacement."); if (action.type !== "crm_action") return; assert.equal(action.operation.op, "flow_status"); if (action.operation.op === "flow_status") { assert.equal(action.operation.flowId, id); assert.equal(action.operation.status, "live"); } },
});
assert.equal(plan.actions.length, 1);
const receipt = { passed: true, provider: "vercel-ai-gateway", syntheticOnly: true, businessWrites: false, providerCalls: calls, reads, contractVersion: plan.contractVersion, actions: plan.actions };
writeFileSync("docs/audit-evidence/scoped-flow-agent-20261107.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ passed: true, providerCalls: calls, reads, action: "flow_status", status: "live", duplicateCreated: false }));
