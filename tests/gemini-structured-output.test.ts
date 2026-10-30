import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { replyWorkPlanSchema } from "../lib/task-workflows.ts";

test("task preparation sends the actual typed extraction schema to Gemini", async () => {
  const schema = z.toJSONSchema(replyWorkPlanSchema.extend({ changes: replyWorkPlanSchema.shape.changes.required() }), { unrepresentable: "any", target: "draft-7" });
  delete schema.$schema;
  let generation: Record<string, unknown> = {};
  await generateGeminiText({ apiKey: "fixture", prompt: "Synthetic customer reply", systemInstruction: "Extract a plan", responseJsonSchema: schema,
    fetcher: async (_url, init) => { generation = JSON.parse(String(init?.body)).generationConfig; return Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }); } });
  const format = generation.responseFormat as { text: { mimeType: string; schema: typeof schema } };
  assert.equal(format.text.mimeType, "APPLICATION_JSON");
  const actual = format.text.schema;
  assert.equal(actual.properties!.changes.properties!.shippingAddress.type, "string");
  assert.equal(actual.properties!.changes.properties!.address.type, "string");
  assert.ok(actual.properties!.changes.required!.includes("address"));
  assert.equal(actual.properties!.items.type, "array");
  assert.equal(JSON.stringify(actual).includes("maxLength"), false);
  assert.equal(JSON.stringify(actual).includes("maximum"), false);
  assert.equal(replyWorkPlanSchema.safeParse({ summary: "Ready", changes: { address: { street: "Road" } }, items: [], missing: [], subject: "Draft", text: "Please review." }).success, false);
});
