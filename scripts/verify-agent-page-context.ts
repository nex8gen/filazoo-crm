// Read-only provider checks with synthetic records. Never reads CRM data or executes actions.
import assert from "node:assert/strict";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../lib/ai/gateway.ts";
import { assistantProviderError } from "../lib/ai/assistant-provider-error.ts";
import { buildWorkspaceAssistantPrompt, extractWorkspaceActions, workspaceAssistantInstruction, workspaceAssistantSchema } from "../lib/ai/workspace-assistant.ts";
import { defaultFlowInput, flowAgentCapabilities } from "../lib/flows.ts";

const id = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
async function plan(pathname: string, question: string, data: object) {
  const input = workspaceAssistantSchema.parse({ mode: "work", pathname, pageLabel: "Synthetic verification", pageText: "", messages: [{ role: "user", content: question }] });
  const options = { systemInstruction: workspaceAssistantInstruction("work", new Date().toISOString()), prompt: buildWorkspaceAssistantPrompt(input, data), maxOutputTokens: 5000,
    fetcher: (async (url, init) => {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45000) });
      if (!response.ok) console.error(`Provider returned HTTP ${response.status}.`);
      return response;
    }) as typeof fetch };
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  let output: string;
  try {
    if (!process.env.GEMINI_API_KEY?.trim()) {
      if (!token) throw new Error("No AI provider configured");
      output = await generateGatewayText({ ...options, token, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
    } else {
      try { output = await generateGeminiText({ ...options, apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_AGENT_MODEL || process.env.GEMINI_EMAIL_MODEL }); }
      catch (error) {
        if (!token || !isGeminiRegionError(error)) throw error;
        output = await generateGatewayText({ ...options, token, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
      }
    }
  } catch (error) {
    const code = (error as { cause?: { code?: string } })?.cause?.code;
    throw new Error(`${assistantProviderError(error)}${code && /^[A-Z_0-9]+$/.test(code) ? ` (${code})` : ""}`);
  }
  const result = extractWorkspaceActions(output);
  assert.equal(result.actions.length, 1, `Expected one action: ${output}`);
  return result.actions[0];
}

const email = await plan("/emails", "Can you write a reply to this email?", {
  currentCompany: null, currentCompanyId: null,
  currentEmail: { id: "synthetic-mail", contact: "buyer@example.com", subject: "Material inquiry", direction: "inbound", text: "I want PLA and TPU95. Monthly volume 500-999 kg.", contentAvailable: true },
  contextWarnings: ["Invoice defaults unavailable. Do not infer missing facts."], products: [], permissions: { canAct: true, role: "admin" },
});
assert.equal(email.type, "write_email");
if (email.type !== "write_email") throw new Error("Expected an email draft");
assert.equal(email.email.delivery, "draft"); assert.equal(email.email.sourceEmailId, "synthetic-mail"); assert.equal(email.email.to, "buyer@example.com");
console.log("PASS: open unmatched email produces a threaded draft despite unavailable invoice defaults.");

const message = await plan("/messenger", "Write a reply to this message.", {
  currentConversation: { id: "instagram:page:customer", customer: "Synthetic buyer", channel: "instagram", replyWindowOpen: true, messages: [{ id, direction: "inbound", text: "Do you have black PLA?" }] }, permissions: { canAct: true, role: "admin" },
});
assert.equal(message.type, "crm_action");
if (message.type !== "crm_action") throw new Error("Expected a message draft");
assert.equal(message.operation.op, "draft_message");
if (message.operation.op !== "draft_message") throw new Error("Must not send a draft");
assert.equal(message.operation.messageId, id);
console.log("PASS: open Messenger conversation produces a draft using the real inbound message ID.");

const edited = { ...defaultFlowInput, name: "My unsaved flow name", status: "paused" as const };
const action = await plan("/lead-channel/ai-agent", "Add a one-day wait at the end of this flow. Keep my unsaved name and all existing steps. Keep it paused.", {
  currentFlow: { id, ...defaultFlowInput, status: "paused" }, flowEditor: { definition: edited, unsaved: true, selectedStepId: "trigger", evidenceOnly: true }, flowCapabilities: flowAgentCapabilities(), permissions: { canAct: true, role: "admin" },
});
assert.equal(action.type, "crm_action");
if (action.type !== "crm_action" || action.operation.op !== "update_flow") throw new Error("Expected an update to the open flow");
assert.equal(action.operation.flowId, id); assert.equal(action.operation.changes.name, edited.name);
assert.equal(action.operation.changes.steps?.length, edited.steps.length + 1);
assert.deepEqual(action.operation.changes.steps?.slice(0, -1).map(({ type, config }) => ({ type, config })), edited.steps.map(({ type, config }) => ({ type, config })));
assert.equal(action.operation.changes.steps?.at(-1)?.type, "wait");
assert.ok(!action.operation.changes.status || action.operation.changes.status === "paused");
console.log("PASS: editing the open flow preserves unsaved changes and existing steps without activation.");
