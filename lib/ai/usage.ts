export type AiTokenUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function gatewayTokenUsage(usage: Record<string, unknown>): AiTokenUsage {
  const details = (usage.input_tokens_details ?? usage.prompt_tokens_details) as Record<string, unknown> | undefined;
  // Gateway completion_tokens already includes any reasoning tokens.
  return { inputTokens: count(usage.input_tokens ?? usage.prompt_tokens), outputTokens: count(usage.output_tokens ?? usage.completion_tokens), cachedInputTokens: count(details?.cached_tokens) };
}
