import assert from "node:assert/strict";
import test from "node:test";
import { generateGeminiText } from "../lib/ai/gemini.ts";

test("sends server-side Gemini requests without putting the API key in the URL", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = input.toString();
    requestInit = init;
    return Response.json({ candidates: [{ content: { parts: [{ text: "Finished email" }] } }] });
  }) as typeof fetch;

  const output = await generateGeminiText({
    apiKey: "test-secret",
    model: "gemini-test",
    systemInstruction: "Edit the email.",
    prompt: "Hello",
    fetcher,
  });

  assert.equal(output, "Finished email");
  assert.match(requestUrl, /gemini-test:generateContent$/);
  assert.ok(!requestUrl.includes("test-secret"));
  assert.equal(new Headers(requestInit?.headers).get("x-goog-api-key"), "test-secret");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    systemInstruction: { parts: [{ text: "Edit the email." }] },
    contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    generationConfig: { maxOutputTokens: 1_200 },
  });
});

test("surfaces Gemini API errors", async () => {
  const fetcher = (async () => Response.json(
    { error: { message: "Quota exceeded" } },
    { status: 429 },
  )) as typeof fetch;

  await assert.rejects(
    generateGeminiText({
      apiKey: "test-secret",
      systemInstruction: "Edit the email.",
      prompt: "Hello",
      fetcher,
    }),
    /Quota exceeded/,
  );
});
