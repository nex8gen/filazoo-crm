import assert from "node:assert/strict";
import test from "node:test";
import { generateGatewayText, isGeminiRegionError } from "../lib/ai/gateway.ts";

test("uses the Vercel AI Gateway chat completions endpoint", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const output = await generateGatewayText({
    token: "test-oidc-token",
    model: "alibaba/qwen-3-14b",
    systemInstruction: "Write concise email.",
    prompt: "Hello",
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "Professional reply" } }] }), { status: 200 });
    },
  });

  assert.equal(requestUrl, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), "Bearer test-oidc-token");
  assert.equal(JSON.parse(String(requestInit?.body)).model, "alibaba/qwen-3-14b");
  assert.equal(output, "Professional reply");
});

test("detects Gemini regional availability errors", () => {
  assert.equal(isGeminiRegionError(new Error("User location is not supported for the API use.")), true);
  assert.equal(isGeminiRegionError(new Error("Rate limit exceeded")), false);
});

test("expired local OIDC tokens fail with a refresh instruction before making a provider request", async () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  let requests = 0;
  await assert.rejects(generateGatewayText({ token: `header.${payload}.signature`, systemInstruction: "Test", prompt: "Test", fetcher: async () => { requests++; throw new Error("Must not fetch"); } }), /authentication has expired.*vercel env pull/);
  assert.equal(requests, 0);
});
