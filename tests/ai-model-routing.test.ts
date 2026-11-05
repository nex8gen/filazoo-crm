import assert from "node:assert/strict";
import test from "node:test";
import { selectAiModel, SIMPLE_AI_MODEL, STANDARD_AI_MODEL, COMPLEX_AI_MODEL, RESEARCH_AI_MODEL } from "../lib/ai/model-routing.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { parseAiUsage, trackAiUsage } from "../lib/ai/chat-usage.ts";
import { gatewayTokenUsage } from "../lib/ai/usage.ts";

test("writing and tagging are cheap, routine actions use Haiku, financial planning and repairs use Gemini 3.5", () => {
  for (const task of ["email", "tagging"] as const) assert.deepEqual(selectAiModel({ task }, {}), { model: SIMPLE_AI_MODEL, tier: "simple", reasoningEffort: "none" });
  for (const task of ["chat", "agent"] as const) assert.equal(selectAiModel({ task, userText: "Attach a catalog to an email draft" }, {}).model, STANDARD_AI_MODEL);
  for (const userText of ["Create an invoice", "Prepare a quotation", "Record this payment", "创建发票"]) assert.equal(selectAiModel({ task: "agent", userText }, {}).model, COMPLEX_AI_MODEL);
  for (const task of ["reply", "workflow"] as const) assert.equal(selectAiModel({ task }, {}).model, COMPLEX_AI_MODEL);
  assert.equal(selectAiModel({ task: "agent", complex: true }, {}).model, COMPLEX_AI_MODEL);
  assert.deepEqual(selectAiModel({ task: "research" }, {}), { model: RESEARCH_AI_MODEL, tier: "research", reasoningEffort: undefined });
  assert.equal(selectAiModel({ task: "email", prompt: "x".repeat(60001) }, {}).model, SIMPLE_AI_MODEL, "Prompt length alone must not trigger a more costly model");
});

test("legacy environment and feature pins cannot select expensive models", () => {
  const expensive = { AI_GATEWAY_SIMPLE_MODEL: "openai/gpt-6-luna", AI_GATEWAY_STANDARD_MODEL: "openai/gpt-6.1-terra", AI_GATEWAY_COMPLEX_MODEL: "openai/gpt-6.1-sol" };
  assert.equal(selectAiModel({ task: "reply" }, expensive).model, COMPLEX_AI_MODEL);
  assert.equal(selectAiModel({ task: "workflow", model: "openai/gpt-6.1-sol", complex: true }, expensive).model, COMPLEX_AI_MODEL);
  assert.equal(selectAiModel({ task: "chat", model: "openai/gpt-5-nano" }, {}).model, STANDARD_AI_MODEL, "Old nano-only environment values cannot suppress task routing");
  assert.equal(selectAiModel({ task: "email", model: STANDARD_AI_MODEL }, {}).model, STANDARD_AI_MODEL, "A priced, audited model override is honored");
  assert.equal(selectAiModel({ task: "agent", userText: "Create an invoice", model: SIMPLE_AI_MODEL }, {}).model, COMPLEX_AI_MODEL, "A generic email/agent pin cannot downgrade financial planning");
});

const completed = { status: "completed", output: [{ type: "reasoning", content: [{ type: "output_text", text: "private reasoning" }] }, { type: "message", content: [{ type: "output_text", text: "Verified answer" }] }], usage: { input_tokens: 100, output_tokens: 20 } };
const base = { token: "synthetic", systemInstruction: "Use verified CRM data.", prompt: "Hello" };

test("Gateway uses the selected vision model through Responses with image evidence, schemas and no provider-side storage", async () => {
  let payload: Record<string, unknown> = {};
  let usage: unknown;
  const output = await generateGatewayText({ ...base, task: "reply", images: [{ label: "image 1", name: "address.png", dataUrl: "data:image/png;base64,AAAA" }], responseJsonSchema: { type: "object" }, onUsage: value => { usage = value; }, fetcher: async (url, init) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v1/responses");
    payload = JSON.parse(String(init?.body));
    return Response.json(completed);
  } });
  assert.equal(output, "Verified answer");
  assert.equal(payload.model, STANDARD_AI_MODEL);
  assert.equal(payload.store, false);
  assert.deepEqual(payload.reasoning, { effort: "none" });
  assert.ok(!("temperature" in payload));
  assert.ok(JSON.stringify(payload.input).includes('"type":"input_image"'));
  assert.equal((payload.text as { format: { type: string } }).format.type, "json_schema");
  assert.deepEqual(usage, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 });
});

test("the non-reasoning research model never receives an unsupported reasoning parameter", async () => {
  await generateGatewayText({ ...base, task: "research", fetcher: async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.model, RESEARCH_AI_MODEL);
    assert.equal("reasoning" in payload, false);
    return Response.json(completed);
  } });
});

test("temporary generation failure retries only once and tracks both billable attempts", async () => {
  let calls = 0;
  const tracker = trackAiUsage(async () => ++calls === 1 ? Response.json({ error: { message: "capacity" } }, { status: 503, headers: { "retry-after": "0" } }) : Response.json(completed));
  assert.equal(await generateGatewayText({ ...base, fetcher: tracker.fetcher }), "Verified answer");
  assert.equal(calls, 2);
  assert.deepEqual(tracker.usage.map(value => value.success), [false, true]);
  assert.equal(tracker.usage[1].inputTokens, 100);
});

test("billing, authentication, permission, and long cooldown errors do not burn credits on retries", async () => {
  for (const status of [400, 401, 402, 403, 404, 429]) {
    let calls = 0;
    await assert.rejects(generateGatewayText({ ...base, fetcher: async () => { calls++; return Response.json({ error: { message: "sensitive provider detail" } }, { status, headers: { "retry-after": "60" } }); } }), error => error instanceof Error && !error.message.includes("sensitive provider detail"));
    assert.equal(calls, 1);
  }
});

test("cancellation never retries, incomplete or refused model output never becomes action text", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(generateGatewayText({ ...base, signal: controller.signal, fetcher: async () => { calls++; return Response.json(completed); } }));
  assert.equal(calls, 0);
  await assert.rejects(generateGatewayText({ ...base, fetcher: async () => Response.json({ ...completed, status: "incomplete" }) }), /incomplete response/);
  await assert.rejects(generateGatewayText({ ...base, fetcher: async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply" }] }] }) }), /empty response/);
});

test("Responses usage estimates include output reasoning tokens once and retain cache counters", () => {
  const usage = { input_tokens: 200, output_tokens: 100, input_tokens_details: { cached_tokens: 50 }, output_tokens_details: { reasoning_tokens: 30 } };
  assert.deepEqual(gatewayTokenUsage(usage), { inputTokens: 200, outputTokens: 100, cachedInputTokens: 50 });
  const parsed = parseAiUsage("https://ai-gateway.vercel.sh/v1/responses", { model: SIMPLE_AI_MODEL }, { usage }, true, { [SIMPLE_AI_MODEL]: { input: 0.1, output: 0.5 } });
  assert.equal(parsed.totalTokens, 300);
  assert.equal(parsed.estimatedCostUsd, 0.00007);
});
