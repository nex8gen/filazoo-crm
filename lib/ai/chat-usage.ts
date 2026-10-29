export type AiUsage = { provider: string; model: string; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; estimatedCostUsd: number | null; success: boolean };
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" ? v as Json : {};
const tokens = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;

/** Cost is only estimated when explicit, model-specific USD rates are configured. */
export function parseAiUsage(url: string, body: unknown, payload: unknown, success: boolean, rates: Record<string, { input: number; output: number }> = {}): AiUsage {
  const result = object(payload), request = object(body);
  const gemini = new URL(url).hostname === "generativelanguage.googleapis.com";
  const usage = object(gemini ? result.usageMetadata : result.usage);
  const model = String(result.modelVersion || result.model || request.model || decodeURIComponent(/\/models\/([^:]+)/.exec(url)?.[1] || "unknown")).slice(0, 200);
  const inputTokens = tokens(gemini ? usage.promptTokenCount : usage.prompt_tokens);
  const outputTokens = gemini ? (tokens(usage.candidatesTokenCount) === null ? null : tokens(usage.candidatesTokenCount)! + (tokens(usage.thoughtsTokenCount) ?? 0)) : tokens(usage.completion_tokens);
  const totalTokens = tokens(gemini ? usage.totalTokenCount : usage.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const rate = rates[model] || rates[String(request.model || /\/models\/([^:]+)/.exec(url)?.[1] || "")];
  const estimatedCostUsd = inputTokens !== null && outputTokens !== null && rate && Number.isFinite(rate.input) && rate.input >= 0 && Number.isFinite(rate.output) && rate.output >= 0
    ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : null;
  return { provider: gemini ? "gemini" : "gateway", model, inputTokens, outputTokens, totalTokens, estimatedCostUsd, success };
}

export function trackAiUsage(fetcher: typeof fetch, rates: Record<string, { input: number; output: number }> = {}) {
  const usage: AiUsage[] = [];
  const tracked: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const hostname = new URL(url).hostname;
    if (!["generativelanguage.googleapis.com", "ai-gateway.vercel.sh"].includes(hostname)) return fetcher(input, init);
    let body: unknown;
    try { body = typeof init?.body === "string" ? JSON.parse(init.body) : {}; } catch { body = {}; }
    try {
      const response = await fetcher(input, init);
      const payload = await response.clone().json().catch(() => ({}));
      usage.push(parseAiUsage(url, body, payload, response.ok, rates));
      return response;
    } catch (error) { usage.push(parseAiUsage(url, body, {}, false, rates)); throw error; }
  };
  return { fetcher: tracked, usage };
}
