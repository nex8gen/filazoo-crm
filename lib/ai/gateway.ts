type GatewayResponse = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
};

export type GenerateGatewayTextOptions = {
  token: string;
  model?: string;
  systemInstruction: string;
  prompt: string;
  maxOutputTokens?: number;
  fetcher?: typeof fetch;
};

export async function generateGatewayText({
  token,
  model = "alibaba/qwen-3-14b",
  systemInstruction,
  prompt,
  maxOutputTokens = 1_200,
  fetcher = fetch,
}: GenerateGatewayTextOptions) {
  const response = await fetcher("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
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
