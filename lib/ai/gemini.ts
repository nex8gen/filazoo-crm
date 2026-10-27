import type { ProviderImage } from "./image-input.ts";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

export type GenerateGeminiTextOptions = {
  apiKey: string;
  model?: string;
  systemInstruction: string;
  prompt: string;
  images?: ProviderImage[];
  maxOutputTokens?: number;
  fetcher?: typeof fetch;
};

export async function generateGeminiText({
  apiKey,
  model = "gemini-3.5-flash-lite",
  systemInstruction,
  prompt,
  images = [],
  maxOutputTokens = 1_200,
  fetcher = fetch,
}: GenerateGeminiTextOptions) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [
        { text: prompt },
        ...images.flatMap((image) => [
          { text: `${image.label}: ${JSON.stringify(image.name)} (user-supplied image evidence)` },
          { inlineData: { mimeType: image.dataUrl.slice(5, image.dataUrl.indexOf(";")), data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) } },
        ]),
      ] }],
      generationConfig: { maxOutputTokens },
    }),
    cache: "no-store",
  });

  const result = await response.json().catch(() => ({})) as GeminiResponse;
  if (!response.ok) {
    throw new Error(result.error?.message || "The AI provider could not process this request.");
  }

  const output = result.candidates
    ?.flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("\n")
    .trim();

  if (!output) throw new Error("The AI provider returned an empty response.");
  return output;
}
