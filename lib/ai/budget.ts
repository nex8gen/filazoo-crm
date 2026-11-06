import { ROUTED_AI_MODELS } from "./model-routing.ts";
export const USD_MICROS = 1_000_000;
// Retain nano while an earlier local/server worker is being restarted. Its
// existing reservations must still settle against the same allowance ledger.
export const BUDGET_MODELS = [...ROUTED_AI_MODELS, "openai/gpt-5-nano"] as const;
export type BudgetRate = { input: number; output: number; context: number; webSearch: number; tiers?: Array<{ min: number; input: number; output: number }> };
function tokenRate(rate: BudgetRate, input: number) {
  return (rate.tiers ?? []).filter(tier => input >= tier.min).sort((a,b) => b.min-a.min)[0] ?? rate;
}
export type BudgetMeter = { usedMicros: number; limitMicros: number; remainingMicros: number; percent: number; resetsAt: string };
export type AiBudgetSummary = { timezone: string; members: number; enabled?: boolean; daily: BudgetMeter; workspaceDaily: BudgetMeter; monthly: BudgetMeter };
export class AiBudgetError extends Error {
  status: number;
  constructor(message: string, status = 429) { super(message); this.name = "AiBudgetError"; this.status = status; }
}
export function budgetMeter(used: number, limit: number, resetsAt: string): BudgetMeter {
  return { usedMicros: used, limitMicros: limit, remainingMicros: Math.max(0, limit - used), percent: limit === 0 ? 100 : Math.min(100, Math.max(0, Math.ceil(used / Math.max(1, limit) * 100))), resetsAt };
}
export function budgetFailure(reason: string, limits?: AiBudgetSummary) {
  if (reason === "user_disabled") return new AiBudgetError("AI is paused for your account. Ask an administrator to enable it in Settings → AI access & behavior.", 403);
  const meter = reason === "user_daily" ? limits?.daily : reason === "workspace_daily" ? limits?.workspaceDaily : reason === "workspace_monthly" ? limits?.monthly : undefined;
  if (meter?.limitMicros === 0) return new AiBudgetError("AI spending is paused by a zero allowance. Ask an administrator to review Settings → AI access & behavior.", 403);
  const exhausted = meter?.remainingMicros === 0;
  if (reason === "user_daily") return new AiBudgetError(exhausted ? "Your daily AI allowance is used up. It resets at midnight China time." : "Your remaining daily AI allowance is too low for this request. Try a smaller task, wait for midnight China time, or ask an administrator to review your limit.");
  if (reason === "workspace_daily") return new AiBudgetError(exhausted ? "The workspace daily AI allowance is used up. It resets at midnight China time." : "The workspace remaining daily AI allowance is too low for this request. Try a smaller task, wait for midnight China time, or ask an administrator to review the workspace limit.");
  if (reason === "workspace_monthly") return new AiBudgetError(exhausted ? "The workspace monthly AI budget is used up. It resets on the first day of next month." : "The workspace remaining monthly AI budget is too low for this request. Try a smaller task or ask an administrator to review the workspace budget.");
  return new AiBudgetError("This request needs more AI allowance than is available. Try a smaller task or wait for the allowance to reset.");
}
export function quoteAiBudget(body: Record<string, unknown>, rate: BudgetRate) {
  const model = String(body.model ?? "");
  if (body.background || body.stream || body.previous_response_id || body.conversation || body.service_tier && body.service_tier !== "default") throw new AiBudgetError("This AI request cannot be priced safely within the workspace allowance.", 503);
  if (!(BUDGET_MODELS as readonly string[]).includes(model)) throw new AiBudgetError("This AI model is not configured for workspace spending limits.", 503);
  const tools = Array.isArray(body.tools) ? body.tools as Array<{ type?: string; name?: string; parameters?: unknown }> : [];
  // Function declarations execute locally, so their schema bytes are priced as
  // input and generated arguments as output. They incur no provider tool fee.
  if (tools.some(tool => tool.type !== "web_search" && !(tool.type === "function" && typeof tool.name === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(tool.name) && tool.parameters && typeof tool.parameters === "object"))) throw new AiBudgetError("This AI tool is not configured for workspace spending limits.", 503);
  const hasWeb = tools.some(tool => tool.type === "web_search");
  const webCalls = hasWeb ? Number(body.max_tool_calls) : 0;
  if (hasWeb && (!Number.isSafeInteger(webCalls) || webCalls < 1 || webCalls > 1)) throw new AiBudgetError("Web research must have a bounded search allowance.", 503);
  const encoded = JSON.stringify(body);
  const output = Number(body.max_output_tokens ?? body.max_tokens);
  if (!Number.isSafeInteger(output) || output < 1 || output > 16000) throw new AiBudgetError("This AI request has no supported output limit.", 503);
  // UTF-8 bytes bound text tokenization. OpenAI caps search context at 128k.
  // Image tokenization is opaque, so retain the full model-context bound.
  const textBound = new TextEncoder().encode(encoded).length + 4096;
  const input = /"(?:input_image|image_url)"/.test(encoded) ? rate.context : Math.min(rate.context, textBound + (webCalls ? 128000 : 0));
  const prices = tokenRate(rate, input + output);
  return { reservedMicros: Math.ceil((input * prices.input + output * prices.output + webCalls * rate.webSearch) * USD_MICROS), output, webCalls };
}
export function chargedAiBudget(payload: unknown, rate: BudgetRate, quote: ReturnType<typeof quoteAiBudget>, status: number) {
  const result = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const usage = result.usage as Record<string, unknown> | undefined;
  const input = usage?.input_tokens ?? usage?.prompt_tokens;
  const output = usage?.output_tokens ?? usage?.completion_tokens;
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && typeof output === "number" && Number.isSafeInteger(output) && output >= 0) {
    // Maximum published context-tier prices; cached input discounts are not
    // assumed. Search is charged at its full reserved tool-call allowance.
    const prices = tokenRate(rate, input + output);
    const cost = Math.ceil((input * prices.input + output * prices.output + quote.webCalls * rate.webSearch) * USD_MICROS);
    if (cost > quote.reservedMicros) throw new AiBudgetError("AI usage exceeded its reserved allowance. Further requests need administrator review.", 503);
    return cost;
  }
  if ([400, 401, 402, 403, 404, 413, 422, 429].includes(status)) return 0;
  // Missing usage, connection loss and unfinished requests retain their entire
  // reservation. Never return uncertain billed usage to the available budget.
  return quote.reservedMicros;
}
