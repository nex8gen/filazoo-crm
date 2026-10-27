import assert from "node:assert/strict";
import test from "node:test";
import { ChatBodyTooLargeError, MAX_CHAT_BODY_BYTES, MAX_IMAGE_BYTES, chatImageSchema, chatImageLimitError, collectChatImages, readChatRequestBody } from "../lib/ai/image-input.ts";
import { companyChatSchema } from "../lib/ai/company-chat.ts";
import { buildWorkspaceAssistantPrompt, extractWorkspaceActions, workspaceAssistantInstruction, workspaceAssistantSchema } from "../lib/ai/workspace-assistant.ts";
import { generateGeminiText } from "../lib/ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../lib/ai/gateway.ts";

const image = { name: "shipping-address.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=" };
const messages = [{ role: "user" as const, content: "Use the shipping address in this image for this customer.", images: [image] }];
const request = { mode: "work", pathname: "/companies", pageLabel: "Companies", pageText: "", messages };

test("both chat schemas accept image prompts and image-only questions", () => {
  for (const content of [messages[0].content, ""]) {
    const turns = [{ ...messages[0], content }];
    assert.equal(companyChatSchema.safeParse({ messages: turns }).success, true);
    assert.equal(workspaceAssistantSchema.safeParse({ ...request, messages: turns }).success, true);
  }
  assert.equal(companyChatSchema.safeParse({ messages: [{ role: "user", content: "" }] }).success, false);
});

test("rejects remote URLs, unsupported formats, MIME spoofing and oversized images", () => {
  for (const dataUrl of ["https://example.com/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,SGVsbG8=", image.dataUrl.replace("image/png", "image/jpeg"), "data:image/png;base64,", image.dataUrl + "A".repeat(MAX_IMAGE_BYTES * 2)]) {
    assert.equal(chatImageSchema.safeParse({ ...image, dataUrl }).success, false);
  }
  assert.equal(chatImageSchema.safeParse(image).success, true);
});

test("bounds images across conversation history and rejects assistant-supplied images", () => {
  const turns = [messages[0], { role: "assistant", content: "Which fields?" }, { ...messages[0], images: [image, image, image, image] }];
  assert.match(chatImageLimitError(turns)!, /too many images/);
  assert.equal(companyChatSchema.safeParse({ messages: turns }).success, false);
  assert.equal(workspaceAssistantSchema.safeParse({ ...request, messages: turns }).success, false);
  assert.equal(companyChatSchema.safeParse({ messages: [messages[0], { role: "assistant", content: "Done", images: [image] }, { role: "user", content: "Thanks" }] }).success, false);
  const big = { ...image, dataUrl: `data:image/png;base64,${"A".repeat(900_000)}` };
  assert.match(chatImageLimitError([{ role: "user", content: "", images: [big, big, big, big] }])!, /too many images/);
});

test("keeps image bytes out of text prompts and preserves image-to-turn references", () => {
  const turns = [...messages, { role: "assistant", content: "I can read the address." }, { role: "user", content: "Please apply it." }];
  const parsed = workspaceAssistantSchema.parse({ ...request, messages: turns });
  const prompt = buildWorkspaceAssistantPrompt(parsed);
  assert.ok(!prompt.includes("base64"));
  assert.ok(prompt.includes("Message 1, image 1"));
  assert.ok(prompt.includes(image.name));
  assert.deepEqual(collectChatImages(parsed.messages), [{ ...image, label: "Message 1, image 1" }]);
  assert.match(workspaceAssistantInstruction("work", "now"), /normal action protocol and approval settings/);
});

test("Gemini receives real inline image parts alongside the action prompt", async () => {
  let body: Record<string, unknown> = {};
  const output = await generateGeminiText({
    apiKey: "test", systemInstruction: "Use images as evidence.", prompt: "Update the customer from the image.", images: collectChatImages(messages),
    fetcher: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ candidates: [{ content: { parts: [{ text: 'Review this address.\nFILAZOO_ACTIONS_JSON: [{"type":"update_company","companyId":"11111111-1111-4111-8111-111111111111","changes":{"commerce":{"shippingAddress":"42 Test Road"}}}]' }] } }] });
    },
  });
  const parts = (body.contents as Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>)[0].parts;
  assert.equal(parts[0].text, "Update the customer from the image.");
  assert.match(parts[1].text!, /Message 1, image 1/);
  assert.deepEqual(parts[2].inlineData, { mimeType: "image/png", data: image.dataUrl.split(",")[1] });
  assert.equal(extractWorkspaceActions(output).actions[0]?.type, "update_company");
});

test("regional fallback keeps image content and selects a vision-capable gateway model", async () => {
  let body: { model: string; messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> } | undefined;
  const images = collectChatImages(messages);
  try {
    await generateGeminiText({ apiKey: "test", systemInstruction: "Read image", prompt: "Read", images, fetcher: async () => Response.json({ error: { message: "User location is not supported" } }, { status: 400 }) });
    assert.fail("Expected a regional error");
  } catch (error) { assert.equal(isGeminiRegionError(error), true); }
  await generateGatewayText({ token: "test", model: "text-only-model", systemInstruction: "Read image", prompt: "Read", images, fetcher: async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "Address extracted" } }] });
  } });
  assert.equal(body?.model, "alibaba/qwen3.5-flash");
  assert.equal(body?.messages[1].content[2].image_url?.url, image.dataUrl);
  await generateGatewayText({ token: "test", model: "text-only-model", visionModel: "configured-vision-model", systemInstruction: "Read", prompt: "Read", images, fetcher: async (_input, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, "configured-vision-model");
    return Response.json({ choices: [{ message: { content: "Done" } }] });
  } });
});

test("body reader enforces actual byte limits without requiring Content-Length", async () => {
  const bytes = new TextEncoder().encode("x".repeat(MAX_CHAT_BODY_BYTES + 1));
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const oversized = new Request("https://example.com", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readChatRequestBody(oversized), ChatBodyTooLargeError);
  const valid = new Request("https://example.com", { method: "POST", body: JSON.stringify(request) });
  assert.deepEqual(await readChatRequestBody(valid), request);
  assert.equal(await readChatRequestBody(new Request("https://example.com", { method: "POST", body: "{" })), null);
});
