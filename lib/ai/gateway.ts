import type { ProviderImage } from "./image-input.ts";

type GatewayResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
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
};

export async function generateGatewayText({
  token,
  model = "alibaba/qwen-3-14b",
  systemInstruction,
  prompt,
  images = [],
  visionModel,
  maxOutputTokens = 1_200,
  fetcher = fetch,
}: GenerateGatewayTextOptions) {
  let expiresAt: unknown;
  try { if (token.split(".").length === 3) expiresAt = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp; } catch { /* Opaque API keys need no JWT inspection. */ }
  if (typeof expiresAt === "number" && expiresAt * 1000 <= Date.now()) throw new Error("AI Gateway authentication has expired. Refresh the linked project's local development token with vercel env pull, then reload the server environment.");
  const response = await fetcher("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: images.length ? visionModel || "alibaba/qwen3.5-flash" : model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: images.length ? [
          { type: "text", text: prompt },
          ...images.flatMap((image) => [
            { type: "text", text: `${image.label}: ${JSON.stringify(image.name)} (user-supplied image evidence)` },
            { type: "image_url", image_url: { url: image.dataUrl } },
          ]),
        ] : prompt },
      ],
      max_tokens: maxOutputTokens,
      temperature: 0.2,
    }),
    cache: "no-store",
  });

  const result = await response.json().catch(() => ({})) as GatewayResponse;
  if (!response.ok) {
    throw new Error(result.error?.message || "The fallback AI provider could not process this request.");
  }

  const content = result.choices?.[0]?.message?.content;
  const output = typeof content === "string"
    ? content.trim()
    : content?.map((part) => part.text || "").join("\n").trim();

  if (!output) throw new Error("The fallback AI provider returned an empty response.");
  return output;
}

export function isGeminiRegionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /location is not supported|unsupported (?:user )?location|region is not supported/i.test(message);
}
