// Explicit, bounded provider comparison using synthetic data only. Never reads
// the CRM, creates business records, sends mail, or changes application budgets.
// node --env-file=.env.local --experimental-strip-types scripts/benchmark-ai-models.ts --live
import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { buildWorkspaceAssistantPrompt, workspaceAssistantInstruction, workspaceAssistantSchema, extractWorkspaceActions } from "../lib/ai/workspace-assistant.ts";
import { buildEmailRewriteInstruction, buildEmailRewritePrompt } from "../lib/ai/email-rewrite.ts";
import { selectAiModel, type AiTask } from "../lib/ai/model-routing.ts";

const models = ["google/gemini-2.5-flash-lite", "google/gemini-3.5-flash-lite", "anthropic/claude-haiku-5.5", "openai/gpt-4.1-mini", "openai/gpt-5-nano"];
const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
const companyId = "ad9cb9f8-e098-44f0-a078-20eed16ef1bd";
const signature = { name: "Alex", title: "Sales Manager", company: "Filazoo" };
const serverData = { currentCompanyId: companyId, currentCompany: { id: companyId, fields: { name: "Example Print Studio", contactName: "Abe M", contactEmail: "abe@example.com", "commerce.currency": "USD" } }, currentEmail: { id: "synthetic-email", contact: "abe@example.com", subject: "PLA Basic inquiry", text: "Please send your latest filament catalog. We use PLA Basic black, 500 pieces. Our delivery address is already on file." }, emailHistory: [{ direction: "inbound", contact: "abe@example.com", text: "Please send your latest filament catalog." }], invoiceDefaults: { currency: "USD" }, products: [{ sku: "PLA-BASIC", name: "PLA Basic", currency: "USD", priceMinor: 500, moq: 1, variants: [{ id: "black", name: "Black", sku: "PLA-BLACK", priceMinor: 500 }] }], permissions: { role: "admin", canAct: true } };
const agent = (messages: Array<{ role: "user" | "assistant"; content: string }>) => ({ system: workspaceAssistantInstruction("work", "2026-11-05T01:00:00Z"), prompt: buildWorkspaceAssistantPrompt(workspaceAssistantSchema.parse({ mode: "work", approvalMode: "ask", pathname: "/email", pageLabel: "Email", pageText: "", messages }), serverData) });
const cases = [
  { name: "catalog-followup", ...agent([{ role: "user", content: "can you create catelog for this costomer" }, { role: "assistant", content: "Do you want a private catalog or one attached to an email draft?" }, { role: "user", content: "catalog attached to a emial draft" }]), validate: (output: string) => { const p = extractWorkspaceActions(output, true); const a = p.actions[0]; return p.protocolValid && p.actions.length === 1 && a.type === "write_email" && a.email.to === "abe@example.com" && a.email.delivery === "draft" && a.email.attachCatalog === true && a.email.text.split(/\s+/).length <= 130 && !/capacity|\$|in stock|from Example Print Studio|Example Print Studio.*(?:Team|Sales)/i.test(a.email.text + a.email.subject); } },
  { name: "invoice-from-history", ...agent([{ role: "user", content: "Create a draft invoice for this customer's confirmed 500 black PLA Basic. Use the saved details. Do not send it." }]), validate: (output: string) => { const p = extractWorkspaceActions(output, true); const a = p.actions[0]; return p.protocolValid && p.actions.length === 1 && a.type === "create_invoice" && a.companyId === companyId && a.items[0].productSku === "PLA-BASIC" && a.items[0].quantity === 500 && a.items[0].variantId === "black" && !a.email; } },
  { name: "concise-email", system: buildEmailRewriteInstruction(signature), prompt: buildEmailRewritePrompt({ recipient: "Abe", managerInput: "send catalog and tell him black PLA basic is included. ask if he needs a quote for the 500 pieces. no extra questions", customerProfile: { companyName: "Example Print Studio", contactName: "Abe M" }, conversationHistory: [{ direction: "inbound", body: "Please send your current filament catalog. We are considering 500 pieces of black PLA Basic." }] }), validate: (output: string) => output.split(/\s+/).length <= 130 && /500/.test(output) && /PLA/i.test(output) && !/next steps|^subject:|^\s*\d+[.)]|^\s*[-*#]/im.test(output) && (output.match(/\?/g)?.length ?? 0) <= 1 },
];
const selectedOnly = process.argv.includes("--selected");
if (selectedOnly) {
  const invoiceCase = cases.find(c => c.name === "invoice-from-history")!;
  cases.push({ ...invoiceCase, name: "invoice-protocol-repair", prompt: `${invoiceCase.prompt}\n\nSERVER_ACTION_CORRECTION: The previous response placed sourceEmailId inside details, which is invalid. Nothing was executed. Continue the original invoice request with the exact supported schema; sourceEmailId belongs at the top level. Use saved defaults; do not invent optional dates, tax, or email actions.` });
  cases.push({ name: "catalog-create", ...agent([{ role: "user", content: "can you create catelog for this costomer" }]), validate: (output: string) => { const p = extractWorkspaceActions(output, true); const a = p.actions[0]; return p.protocolValid && p.actions.length === 1 && a.type === "crm_action" && a.operation.op === "create_catalog" && a.operation.companyId === companyId && a.operation.currency === "USD" && a.operation.productSkus.length === 0; } });
}
const routeFor = (name: string) => selectAiModel({ task: (name === "concise-email" ? "email" : "agent") as AiTask, userText: name.startsWith("invoice") ? "Create an invoice" : "Create a catalog", complex: name === "invoice-protocol-repair" });
const candidates = selectedOnly ? [...new Set(cases.map(c => routeFor(c.name).model))] : models;
if (!process.argv.includes("--live")) { console.log(JSON.stringify({ models: candidates, cases: cases.map(c => c.name), maximumQuotedUsd: 0.10, syntheticOnly: true })); process.exit(0); }
if (!token) throw new Error("A configured Gateway credential is required.");
const catalogResponse = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(12000) });
if (!catalogResponse.ok) throw new Error("The live model catalog is unavailable.");
const catalog = (await catalogResponse.json()).data as Array<{ id: string; pricing: { input: string; output: string; input_cache_write?: string }; reasoning_options?: Array<{ type: string; values?: string[] }> }>;
let reserved = 0;
const results: Array<Record<string, unknown>> = [];
for (const model of candidates) {
  const meta = catalog.find(m => m.id === model);
  if (!meta) throw new Error("Candidate is absent from the live catalog.");
  const effort = meta.reasoning_options?.find(o => o.type === "effort")?.values?.[0];
  const group = await Promise.all(cases.filter(c => !selectedOnly || routeFor(c.name).model === model).map(async (c) => {
    const maxOutputTokens = c.name === "concise-email" ? 700 : 1600;
    const quoted = (Buffer.byteLength(c.system + c.prompt, "utf8") + 4096) * Math.max(Number(meta.pricing.input), Number(meta.pricing.input_cache_write ?? meta.pricing.input)) + maxOutputTokens * Number(meta.pricing.output);
    if (reserved + quoted > 0.10) return { model, case: c.name, skipped: "comparison cost cap" };
    reserved += quoted;
    const started = performance.now();
    try {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, instructions: c.system, input: c.prompt, max_output_tokens: maxOutputTokens, store: false, ...(effort ? { reasoning: { effort } } : {}) }), signal: AbortSignal.timeout(40000) });
      const payload = await response.json();
      const output = (payload.output ?? []).filter((i: { type: string }) => i.type === "message").flatMap((i: { content?: Array<{ type: string; text?: string }> }) => i.content ?? []).filter((p: { type: string }) => p.type === "output_text").map((p: { text?: string }) => p.text ?? "").join("\n").trim();
      const usage = payload.usage;
      const charged = usage ? usage.input_tokens * Number(meta.pricing.input) + usage.output_tokens * Number(meta.pricing.output) : quoted;
      const result = { model, case: c.name, status: response.status, elapsedMs: Math.round(performance.now() - started), passed: response.ok && payload.status === "completed" && c.validate(output), estimatedUsd: charged, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, output, ...(response.ok ? {} : { errorCode: payload.error?.code }) };
      console.log(JSON.stringify({ ...result, output: undefined }));
      return result;
    } catch (error) { const result = { model, case: c.name, passed: false, elapsedMs: Math.round(performance.now() - started), error: error instanceof Error ? error.name : "unknown" }; console.log(JSON.stringify(result)); return result; }
  }));
  results.push(...group);
  mkdirSync("tmp", { recursive: true });
  writeFileSync(`tmp/ai-model-benchmark-${selectedOnly ? "selected-" : ""}20261105.json`, JSON.stringify({ syntheticOnly: true, quotedUsd: reserved, results }, null, 2));
}
if (selectedOnly && results.some(result => result.passed !== true)) process.exitCode = 1;
