export type AiTask = "chat" | "agent" | "email" | "reply" | "tagging" | "workflow" | "research";
export type ModelRoutingInput = { task?: AiTask; userText?: string; complex?: boolean; standard?: boolean; prompt?: string; model?: string; hasImages?: boolean; visionModel?: string };

// Live Gateway catalog and bounded synthetic CRM evaluations, 2026-11-05.
export const SIMPLE_AI_MODEL = "google/gemini-2.5-flash-lite";
export const STANDARD_AI_MODEL = "anthropic/claude-haiku-5.5";
export const COMPLEX_AI_MODEL = "google/gemini-3.5-flash-lite";
export const RESEARCH_AI_MODEL = "openai/gpt-4.1-mini";
export const AI_MODEL_PROFILES = {
  [SIMPLE_AI_MODEL]: { reasoningEffort: "none" },
  [STANDARD_AI_MODEL]: { reasoningEffort: "none" },
  [COMPLEX_AI_MODEL]: { reasoningEffort: "low" },
  [RESEARCH_AI_MODEL]: { reasoningEffort: undefined },
} as const;
export const ROUTED_AI_MODELS = Object.keys(AI_MODEL_PROFILES) as Array<keyof typeof AI_MODEL_PROFILES>;
const supported = (value: string | undefined): value is keyof typeof AI_MODEL_PROFILES => Boolean(value && Object.hasOwn(AI_MODEL_PROFILES, value));

/** No classification request, arbitrary provider pins, or premium-model fallbacks. */
export function selectAiModel(input: ModelRoutingInput, env: Record<string, string | undefined> = process.env) {
  const financial = input.task === "agent" && /\b(?:invoice|invioce|inovice|quotation|quote|purchase order|payment|billing|refund)\b|发票|报价|付款|退款/i.test(input.userText ?? "");
  const tier = input.hasImages ? "standard" : input.task === "research" ? "research" : input.complex || financial || input.task === "reply" || input.task === "workflow" ? "complex" : input.standard || input.task === "agent" || input.task === "chat" ? "standard" : "simple";
  const defaults = { simple: SIMPLE_AI_MODEL, standard: STANDARD_AI_MODEL, complex: COMPLEX_AI_MODEL, research: RESEARCH_AI_MODEL } as const;
  const configured = input.hasImages ? input.visionModel ?? env.AI_GATEWAY_VISION_MODEL : tier === "complex" ? env.AI_GATEWAY_COMPLEX_MODEL : input.model ?? env[`AI_GATEWAY_${tier.toUpperCase()}_MODEL`];
  // Old nano-only environment values are intentionally ignored. All selected
  // models must have live pricing and a matching database reservation policy.
  const model = supported(configured) ? configured : defaults[tier];
  return { model, tier, reasoningEffort: AI_MODEL_PROFILES[model].reasoningEffort };
}
