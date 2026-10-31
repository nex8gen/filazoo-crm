export type AiTokenUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function geminiTokenUsage(usage: Record<string, unknown>): AiTokenUsage {
  return { inputTokens: count(usage.promptTokenCount), outputTokens: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount), cachedInputTokens: count(usage.cachedContentTokenCount) };
}
export function gatewayTokenUsage(usage: Record<string, unknown>): AiTokenUsage {
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  // Gateway completion_tokens already includes any reasoning tokens.
  return { inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens), cachedInputTokens: count(details?.cached_tokens) };
}
