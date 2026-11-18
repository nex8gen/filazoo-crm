import assert from "node:assert/strict";
import test from "node:test";
import { generateGatewayText, type GatewayGeneration } from "../lib/ai/gateway.ts";

test("uses the cheap writing model through Responses when an unsupported legacy pin requests another model", async () => {
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
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Professional reply" }] }] });
    },
  });

  assert.equal(requestUrl, "https://ai-gateway.vercel.sh/v1/responses");
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), "Bearer test-oidc-token");
  assert.equal(JSON.parse(String(requestInit?.body)).model, "google/gemini-2.5-flash-lite");
  assert.equal(output, "Professional reply");
});



test("expired local OIDC tokens fail with a refresh instruction before making a provider request", async () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  let requests = 0;
  await assert.rejects(generateGatewayText({ token: `header.${payload}.signature`, systemInstruction: "Test", prompt: "Test", fetcher: async () => { requests++; throw new Error("Must not fetch"); } }), /authentication has expired.*vercel env pull/);
  assert.equal(requests, 0);
});

test("billing identities are captured for every provider attempt, including retries and rejected output", async () => {
  const generations: GatewayGeneration[] = [];
  let calls = 0;
  const result = await generateGatewayText({ token: "synthetic", systemInstruction: "Test", prompt: "Test", onGeneration: async value => { generations.push(value); }, fetcher: async () => ++calls === 1
    ? Response.json({ id: "gen_retry", usage: { input_tokens: 10, output_tokens: 2 } }, { status: 503, headers: { "retry-after": "0" } })
    : Response.json({ id: "gen_completed", model: "actual/model", usage: { input_tokens: 20, output_tokens: 5 }, output: [{ type: "message", content: [{ type: "output_text", text: "Reply" }] }] }) });
  assert.equal(result, "Reply");
  assert.deepEqual(generations.map(g => [g.generationId, g.inputTokens, g.outputTokens, g.success]), [["gen_retry", 10, 2, false], ["gen_completed", 20, 5, true]]);
  await assert.rejects(generateGatewayText({ token: "synthetic", prompt: "Test", systemInstruction: "Test", onGeneration: async value => { generations.push(value); }, fetcher: async () => Response.json({ id: "gen_incomplete", status: "incomplete" }) }), /incomplete/);
  assert.equal(generations.at(-1)?.generationId, "gen_incomplete");
});
