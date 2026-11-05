import type { ProviderImage } from "./image-input.ts";
import { gatewayTokenUsage, type AiTokenUsage } from "./usage.ts";
import { selectAiModel, type AiTask } from "./model-routing.ts";

type GatewayResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
  usage?: Record<string, unknown>;
  status?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
};

export type GenerateGatewayTextOptions = {
  token: string;
  model?: string;
  systemInstruction: string;
  prompt: string;
  images?: ProviderImage[];
  visionModel?: string;
  maxOutputTokens?: number;
  fetcher?: typeof fetch;
  onUsage?: (usage: AiTokenUsage) => void;
  task?: AiTask;
  userText?: string;
  complex?: boolean;
  standard?: boolean;
  responseJsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  usageUserId?: string;
};

export async function generateGatewayText({
  token,
  model,
  systemInstruction,
  prompt,
  images = [],
  visionModel,
  maxOutputTokens = 1_200,
  fetcher = fetch,
  onUsage,
  task,
  userText,
  complex,
  standard,
  responseJsonSchema,
  signal,
  usageUserId,
}: GenerateGatewayTextOptions) {
  if (process.env.AI_BUDGET_ENFORCEMENT === "true") {
    if (!usageUserId) throw Object.assign(new Error("AI usage could not be linked to an active workspace member."), { name: "AiBudgetError", status: 503 });
    const { budgetedAiFetch } = await import("./budget-server.ts");
    fetcher = budgetedAiFetch(usageUserId, fetcher);
  }
  let expiresAt: unknown;
  try { if (token.split(".").length === 3) expiresAt = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp; } catch { /* Opaque API keys need no JWT inspection. */ }
  if (typeof expiresAt === "number" && expiresAt * 1000 <= Date.now()) throw new Error("AI Gateway authentication has expired. Refresh the linked project's local development token with vercel env pull, then reload the server environment.");
  const routing = selectAiModel({ model, task, userText, complex, standard, prompt, hasImages: images.length > 0, visionModel });
  const selectedModel = routing.model;
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(55_000)]);
  for (let attempt = 0; attempt < 2; attempt++) {
    deadline.throwIfAborted();
    const attemptSignal = AbortSignal.any([deadline, AbortSignal.timeout(35_000)]);
    let response: Response;
    try {
      response = await fetcher("https://ai-gateway.vercel.sh/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: selectedModel,
            instructions: systemInstruction,
            input: [{ role: "user", content: [
              { type: "input_text", text: prompt },
              ...images.flatMap((image) => [
                { type: "input_text", text: `${image.label}: ${JSON.stringify(image.name)} (user-supplied image evidence)` },
                { type: "input_image", image_url: image.dataUrl, detail: "auto" },
              ]),
            ] }],
            max_output_tokens: maxOutputTokens,
            ...(routing.reasoningEffort ? { reasoning: { effort: routing.reasoningEffort } } : {}),
            store: false,
            ...(responseJsonSchema ? { text: { format: { type: "json_schema", name: "crm_result", strict: false, schema: responseJsonSchema } } } : {}),
          }),
          cache: "no-store",
          signal: attemptSignal,
        });
    } catch (error) {
      if (deadline.aborted || signal?.aborted) throw error;
      if (attempt === 0 && (error instanceof TypeError || attemptSignal.aborted)) continue;
      throw error;
    }

    const result = await response.json().catch(() => ({})) as GatewayResponse;
    if (result.usage) onUsage?.(gatewayTokenUsage(result.usage));
    if (!response.ok) {
      if (attempt === 0 && [408, 409, 429, 500, 502, 503, 504].includes(response.status)) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? (/^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 300;
        // Do not ignore a long provider cooldown or hold a CRM request open indefinitely.
        if (Number.isFinite(delay) && delay >= 0 && delay <= 2000) {
          await new Promise<void>((resolve, reject) => {
            const done = () => { deadline.removeEventListener("abort", aborted); resolve(); };
            const timer = setTimeout(done, delay);
            const aborted = () => { clearTimeout(timer); reject(deadline.reason); };
            deadline.addEventListener("abort", aborted, { once: true });
            if (deadline.aborted) aborted();
          });
          continue;
        }
      }
      if (response.status === 401) throw new Error("AI Gateway authentication failed. Refresh the development token or configure a valid AI Gateway API key.");
      if (response.status === 402) throw new Error("AI Gateway credits or spending budget are exhausted. Add credits or review the configured budget in Vercel.");
      if (response.status === 403) throw new Error("AI Gateway access is blocked. Check the team's payment verification and model permissions in Vercel.");
      if (response.status === 429) throw new Error("AI Gateway is busy or its rate limit was reached. Please try again shortly.");
      throw new Error("AI Gateway could not process this request. Check model availability and provider status in Vercel.");
    }

    if (result.status && result.status !== "completed") throw new Error("AI returned an incomplete response. No actions from it can be prepared. Please retry with a smaller task.");
    const output = result.output?.filter((item) => item.type === "message").flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text || "").join("\n").trim();

    if (!output) throw new Error("The fallback AI provider returned an empty response.");
    return output;
  }
  throw new Error("AI Gateway could not respond. Please retry shortly.");
}

export function isGeminiRegionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /location is not supported|unsupported (?:user )?location|region is not supported/i.test(message);
}
