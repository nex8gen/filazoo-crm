import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeEnglish, translateEmailSegments, translateEnglishEmail } from "../lib/email-translation.ts";
import { requestEmailTranslation } from "../lib/email-translation-client.ts";

test("recovers from a temporary connection failure", async () => {
  let requests = 0;
  const output = await translateEnglishEmail("Welcome to Make, raul!", (async () => {
    if (++requests === 1) throw new TypeError("fetch failed");
    return Response.json([[["Welcome translated"]]]);
  }) as typeof fetch);
  assert.equal(output, "Welcome translated");
  assert.equal(requests, 2);
});

test("reuses successful segments when retrying a partially failed email", async () => {
  const requests: string[] = [];
  let unavailable = true;
  const fetcher = (async (input) => {
    const text = new URL(String(input)).searchParams.get("q")!;
    requests.push(text);
    if (text === "Second paragraph" && unavailable) throw new TypeError("fetch failed");
    return Response.json([[[`translated ${text}`]]]);
  }) as typeof fetch;
  await assert.rejects(translateEmailSegments(["Welcome", "Second paragraph"], fetcher), /Could not connect/);
  unavailable = false;
  assert.deepEqual(await translateEmailSegments(["Welcome", "Second paragraph"], fetcher), ["translated Welcome", "translated Second paragraph"]);
  assert.equal(requests.filter((text) => text === "Welcome").length, 1);
});

test("caps provider concurrency across emails and deduplicates identical text", async () => {
  let active = 0;
  let peak = 0;
  let requests = 0;
  const fetcher = (async (input) => {
    requests++;
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return Response.json([[[new URL(String(input)).searchParams.get("q")!]]]);
  }) as typeof fetch;
  await Promise.all(Array.from({ length: 5 }, (_, index) => translateEmailSegments(["Welcome", `Email ${index}`, "View email"], fetcher)));
  assert.ok(peak <= 4);
  assert.equal(requests, 7);
});

test("batches large HTML emails without changing text-node order", async () => {
  const segments = Array.from({ length: 510 }, (_, index) => `Paragraph ${index} ${"text ".repeat(30)}`);
  let requests = 0;
  const output = await requestEmailTranslation(segments, (async (_input, init) => {
    requests++;
    const body = JSON.parse(String(init?.body));
    assert.ok(body.segments.length <= 40);
    assert.ok(body.segments.join("").length <= 8_000);
    return Response.json({ segments: body.segments.map((text: string) => `translated ${text}`) });
  }) as typeof fetch);
  assert.ok(requests > 1);
  assert.deepEqual(output, segments.map((text) => `translated ${text}`));
});

test("keeps HTML text segments in order with bounded concurrency", async () => {
  let active = 0;
  let peak = 0;
  const segments = Array.from({ length: 9 }, (_, index) => `Message ${index}`);
  const result = await translateEmailSegments([...segments, "12345"], (async (input) => {
    active++;
    peak = Math.max(peak, active);
    const text = new URL(String(input)).searchParams.get("q")!;
    await new Promise((resolve) => setTimeout(resolve, text.endsWith("0") ? 15 : 1));
    active--;
    return Response.json([[[`translated ${text}`]]]);
  }) as typeof fetch);
  assert.deepEqual(result, [...segments.map((text) => `translated ${text}`), "12345"]);
  assert.equal(peak, 4);
});

test("rejects the complete HTML translation when a segment fails", async () => {
  await assert.rejects(translateEmailSegments(["Hello", "Price list"], (async () => new Response("Unavailable", { status: 503 })) as typeof fetch), /temporarily unavailable/);
});

test("detects English customer messages without treating Chinese as English", () => {
  assert.equal(looksLikeEnglish("Hi, can you send your latest price list?"), true);
  assert.equal(looksLikeEnglish("你好，请发送最新价格表。"), false);
});

test("translates an English email to Simplified Chinese with the free provider", async () => {
  const requests: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url);
    return Response.json([[["您好，", "Hello, "], ["您能发送价目表吗？", "can you send the price list?"]]]);
  }) as typeof fetch;

  const result = await translateEnglishEmail("Hello, can you send the price list?", fetcher);

  assert.equal(result, "您好，您能发送价目表吗？");
  assert.equal(requests[0]?.hostname, "translate.googleapis.com");
  assert.equal(requests[0]?.searchParams.get("sl"), "en");
  assert.equal(requests[0]?.searchParams.get("tl"), "zh-CN");
  assert.equal(requests[0]?.searchParams.get("q"), "Hello, can you send the price list?");
});

test("surfaces provider throttling after bounded retries", async () => {
  const fetcher = (async () => Response.json(
    { responseStatus: 429, responseDetails: "Daily request limit reached" },
    { status: 429 },
  )) as typeof fetch;

  await assert.rejects(
    translateEnglishEmail("Please translate this email.", fetcher),
    /busy.*try again shortly/,
  );
});

test("rejects warning objects and malformed successful responses as translations", async () => {
  for (const payload of [null, [], [[]], [[[null]]], { responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS" } }]) {
    await assert.rejects(
      translateEnglishEmail("Please send the price list.", (async () => Response.json(payload)) as typeof fetch),
      /invalid response/,
    );
  }
});

test("splits long messages and translates every chunk in order", async () => {
  const text = "Please send your latest price list. ".repeat(120).trim();
  const chunks: string[] = [];
  const result = await translateEnglishEmail(text, (async (input) => {
    const chunk = new URL(String(input)).searchParams.get("q")!;
    chunks.push(chunk);
    return Response.json([[[`翻译 ${chunks.length}`]]]);
  }) as typeof fetch);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 1500));
  assert.equal(chunks.join(" "), text);
  assert.equal(result, chunks.map((_, index) => `翻译 ${index + 1}`).join("\n\n"));
});

test("uses the configured LibreTranslate server without falling back to Google", async () => {
  const previousUrl = process.env.LIBRETRANSLATE_URL;
  const previousKey = process.env.LIBRETRANSLATE_API_KEY;
  process.env.LIBRETRANSLATE_URL = "https://translate.example.com/";
  process.env.LIBRETRANSLATE_API_KEY = "test-key";
  try {
    const result = await translateEnglishEmail("Hello!", (async (input, init) => {
      assert.equal(String(input), "https://translate.example.com/translate");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { q: "Hello!", source: "en", target: "zh", format: "text", api_key: "test-key" });
      return Response.json({ translatedText: "你好！" });
    }) as typeof fetch);
    assert.equal(result, "你好！");
    let requests = 0;
    await assert.rejects(translateEnglishEmail("Hello!", (async () => {
      requests++;
      return new Response("Unavailable", { status: 503 });
    }) as typeof fetch), /temporarily unavailable/);
    assert.equal(requests, 3);
  } finally {
    if (previousUrl === undefined) delete process.env.LIBRETRANSLATE_URL;
    else process.env.LIBRETRANSLATE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.LIBRETRANSLATE_API_KEY;
    else process.env.LIBRETRANSLATE_API_KEY = previousKey;
  }
});

test("rejects empty input without contacting a provider", async () => {
  await assert.rejects(translateEnglishEmail("  ", (async () => {
    assert.fail("must not contact provider");
  }) as typeof fetch), /Enter an English email/);
});
