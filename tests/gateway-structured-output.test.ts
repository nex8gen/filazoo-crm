import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { generateGatewayText } from "../lib/ai/gateway.ts";
import { replyWorkPlanSchema } from "../lib/task-workflows.ts";

test("task preparation sends the actual typed extraction schema to AI Gateway", async () => {
  const schema = z.toJSONSchema(replyWorkPlanSchema.extend({ changes: replyWorkPlanSchema.shape.changes.required() }), { unrepresentable: "any", target: "draft-7" });
  delete schema.$schema;
  let generation: Record<string, unknown> = {};
  await generateGatewayText({ token: "fixture", prompt: "Synthetic customer reply", systemInstruction: "Extract a plan", responseJsonSchema: schema,
    fetcher: async (_url, init) => { generation = JSON.parse(String(init?.body)); return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] }); } });
  const format = generation.text as { format: { type: string; schema: typeof schema } };
  assert.equal(format.format.type, "json_schema");
  const actual = format.format.schema;
  assert.equal(actual.properties!.changes.properties!.shippingAddress.type, "string");
  assert.equal(actual.properties!.changes.properties!.address.type, "string");
  assert.ok(actual.properties!.changes.required!.includes("address"));
  assert.equal(actual.properties!.items.type, "array");
  assert.equal(JSON.stringify(actual).includes("maxLength"), true);
  assert.equal(JSON.stringify(actual).includes("maximum"), true);
  assert.equal(replyWorkPlanSchema.safeParse({ summary: "Ready", changes: { address: { street: "Road" } }, items: [], missing: [], subject: "Draft", text: "Please review." }).success, false);
});
