import type { ProviderImage } from "./image-input.ts";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

// Large length/range combinations can exceed Gemini's constrained-decoder
// complexity limit. Keep the structural contract here; Zod enforces every bound
// on the server before any CRM state or invoice can be changed.
function generationSchema(schema: Record<string, unknown>) {
  const bounds = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems"]);
  return JSON.parse(JSON.stringify(schema, (key, value) => bounds.has(key) ? undefined : value));
}

export type GenerateGeminiTextOptions = {
  apiKey: string;
  model?: string;
  systemInstruction: string;
  prompt: string;
  images?: ProviderImage[];
  maxOutputTokens?: number;
  responseJsonSchema?: Record<string, unknown>;
  fetcher?: typeof fetch;
};

export async function generateGeminiText({
  apiKey,
  model = "gemini-3.5-flash-lite",
  systemInstruction,
  prompt,
  images = [],
  maxOutputTokens = 1_200,
  responseJsonSchema,
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
      generationConfig: { maxOutputTokens, ...(responseJsonSchema ? { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: generationSchema(responseJsonSchema) } } } : {}) },
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
