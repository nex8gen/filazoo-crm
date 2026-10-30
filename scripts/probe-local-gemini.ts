import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
const env = parseEnv(readFileSync(".env.local", "utf8"));
const apiKey = env.GEMINI_API_KEY;
if (!apiKey) throw new Error("No local Gemini key.");
const model = env.GEMINI_EMAIL_MODEL || "gemini-3.5-flash-lite";
const options = { headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, method: "POST" };
for (const [name, url, body] of [
  ["generateContent", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { contents: [{ role: "user", parts: [{ text: "Respond with OK only." }] }], generationConfig: { maxOutputTokens: 30 } }],
  ["interactions", "https://generativelanguage.googleapis.com/v1beta/interactions", { model, input: "Respond with OK only." }],
] as const) {
  try {
    const response = await fetch(url, { ...options, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const result = await response.json();
    console.log(JSON.stringify({ endpoint: name, model, status: response.status, error: result.error?.message, diagnostic: response.ok ? undefined : JSON.stringify(result).replaceAll(apiKey, "[redacted]").slice(0, 900), reason: result.error?.details?.map?.((item: { reason?: string }) => item.reason).filter(Boolean),
      response: result.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text).join("") || result.outputs?.filter((item: { type: string }) => item.type === "text").map((item: { text: string }) => item.text).join("") }));
  } catch (error) { console.log(JSON.stringify({ endpoint: name, error: error instanceof Error ? error.message : "Request failed" })); }
}
