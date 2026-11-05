// Synthetic provider evaluation only. No CRM access or business side effects.
import assert from "node:assert/strict";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { selectAiModel } from "../lib/ai/model-routing.ts";
import { extractWorkspaceActions, workspaceAssistantInstruction } from "../lib/ai/workspace-assistant.ts";

const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
if (!token) throw new Error("Configure a Gateway credential in the server environment before verification.");
const response = await fetch("https://ai-gateway.vercel.sh/v1/credits", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
const credits = await response.json();
console.log(JSON.stringify({ check: "credits", status: response.status, balance: credits.balance ?? null, totalUsed: credits.total_used ?? null }));
if (!response.ok) process.exitCode = 1;
else if (!process.argv.includes("--live")) console.log("Credit check only. Add --live to evaluate synthetic model requests.");
else if (!(Number(credits.balance) > 0)) { console.log("No positive Gateway balance. Add prepaid credits before live evaluation."); process.exitCode = 1; }
else {
  const prompts = [
    { task: "chat" as const, userText: "Rewrite politely: Please send your shipping address.", systemInstruction: "Rewrite the supplied message politely and concisely. Do not invent facts.", prompt: "Please send your shipping address." },
    { task: "agent" as const, userText: "Create a task to call Acme tomorrow", systemInstruction: workspaceAssistantInstruction("work", new Date().toISOString(), "en"), prompt: 'CONVERSATION: [{"role":"user","content":"Create a task to call Acme tomorrow"}]\nSERVER_DATA: {}' },
    { task: "agent" as const, userText: "Create a draft invoice for Acme", systemInstruction: workspaceAssistantInstruction("work", new Date().toISOString(), "en"), prompt: 'CONVERSATION: [{"role":"user","content":"Create a draft invoice for Acme"}]\nSERVER_DATA: {}' },
  ];
  for (const input of prompts) {
    const routing = selectAiModel(input);
    const output = await generateGatewayText({ ...input, token, maxOutputTokens: 5000 });
    assert.ok(output.length > 0);
    if (input.task === "agent") {
      const parsed = extractWorkspaceActions(output);
      // Lookups/questions are also valid next steps for absent synthetic records.
      assert.ok(parsed.protocolValid || /FILAZOO_(?:QUESTION|CRM_READS?|EMAIL_SEARCH)_JSON:/.test(output), "Agent must return a supported protocol");
      if (input.userText.includes("invoice")) assert.equal(parsed.actions.length, 0, "Missing customer/products cannot produce an invoice");
    }
    console.log(JSON.stringify({ check: input.task, model: routing.model, tier: routing.tier, outputCharacters: output.length, passed: true }));
  }
}
