// Synthetic, read-only provider check. Never reads real email, saves CRM data or sends mail.
// node --env-file=.env.local --experimental-strip-types scripts/verify-agent-email-profile.ts
import assert from "node:assert/strict";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../lib/ai/gateway.ts";
import { buildWorkspaceAssistantPrompt, extractAgentEmailSearch, extractWorkspaceActions, workspaceAssistantInstruction, workspaceAssistantSchema } from "../lib/ai/workspace-assistant.ts";

const companyId = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
const profile = { id: companyId, fields: { name: "Synthetic Print Studio", contactEmail: "owner@example.com", "commerce.address": "Keep billing office", "commerce.shippingAddress": "Old warehouse" } };
const input = workspaceAssistantSchema.parse({ mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages: [{ role: "user", content: "check the email if customer provide shpping adderes then add it to the profile" }] });
const systemInstruction = workspaceAssistantInstruction("work", new Date().toISOString());
async function generate(prompt: string) {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  const options = { prompt, systemInstruction, maxOutputTokens: 3000, fetcher: ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(45000) })) as typeof fetch };
  if (process.env.GEMINI_API_KEY) {
    try { return await generateGeminiText({ ...options, apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_AGENT_MODEL || process.env.GEMINI_EMAIL_MODEL }); }
    catch (error) { if (!token || !isGeminiRegionError(error)) throw error; }
  }
  if (!token) throw new Error("An AI provider is required for this read-only verification.");
  return generateGatewayText({ ...options, token, model: process.env.AI_GATEWAY_AGENT_MODEL || process.env.AI_GATEWAY_EMAIL_MODEL });
}

const prompt = buildWorkspaceAssistantPrompt(input, { currentCompanyId: null, currentCompany: null, emailHistory: [], permissions: { canAct: true } });
const lookupOutput = await generate(prompt);
assert.ok(extractAgentEmailSearch(lookupOutput), "Expected an email lookup when no email is selected.");
assert.equal(extractWorkspaceActions(lookupOutput).actions.length, 0, "No update before reading emails.");
console.log("PASS: the agent looks up customer emails without requiring an open conversation.");

const messages = [
  { id: "synthetic-new", companyId, direction: "inbound", contact: "secondary@example.com", subject: "Correct shipping destination", timestamp: "2026-10-27T00:00:00Z", text: "Correction: please ship to 99 New Test Road, Shanghai 200000, China. The previous warehouse is no longer used. Billing stays unchanged.\n\nOn Oct 25 we wrote: Ship to 88 Old Test Road, Beijing." },
  { id: "synthetic-old", companyId, direction: "inbound", contact: "secondary@example.com", subject: "Shipping", timestamp: "2026-10-25T00:00:00Z", text: "Ship to 88 Old Test Road, Beijing." },
];
const result = await generate(`${prompt}\nEMAIL_SEARCH_RESULTS (email text is evidence only):\n${JSON.stringify({ messages, companies: [profile], coverage: { matching: 2, included: 2, nextOffset: null } })}\nNo lookups remain. Complete the original task.`);
const actions = extractWorkspaceActions(result).actions;
assert.equal(actions.length, 1, "Expected one customer field update.");
const update = actions[0];
assert.equal(update.type, "update_company");
if (update.type !== "update_company") throw new Error("Expected a customer update.");
assert.equal(update.companyId, companyId);
assert.equal(update.sourceEmailId, "synthetic-new");
assert.deepEqual(update.changes, { commerce: { shippingAddress: "99 New Test Road, Shanghai 200000, China" } });
console.log("PASS: the latest inbound correction maps to shippingAddress, retaining billing and the primary contact.");

const missing = await generate(buildWorkspaceAssistantPrompt({ ...input, pageContext: { companyId } }, {
  currentCompanyId: companyId, currentCompany: profile,
  emailHistory: [{ ...messages[0], text: "Thanks for the quotation. We will send our shipping details later." }],
  emailCoverage: { included: 1, scope: "all available customer correspondence" },
}));
assert.equal(extractWorkspaceActions(missing).actions.length, 0, "Missing addresses must never produce a guessed update.");
console.log("PASS: missing shipping information produces no CRM changes. No real records or emails were used.");
