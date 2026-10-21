import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeEnglish, translateEnglishEmail } from "../lib/email-translation.ts";

test("detects English customer messages without treating Chinese as English", () => {
  assert.equal(looksLikeEnglish("Hi, can you send your latest price list?"), true);
  assert.equal(looksLikeEnglish("你好，请发送最新价格表。"), false);
});

test("translates an English email to Simplified Chinese with the free provider", async () => {
  const requests: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url);
    return Response.json({ responseStatus: 200, responseData: { translatedText: "您好，您能发送价目表吗？" } });
  }) as typeof fetch;

  const result = await translateEnglishEmail("Hello, can you send the price list?", fetcher);

  assert.equal(result, "您好，您能发送价目表吗？");
  assert.equal(requests[0]?.searchParams.get("langpair"), "en|zh-CN");
  assert.equal(requests[0]?.searchParams.get("q"), "Hello, can you send the price list?");
});

test("surfaces free-provider errors instead of retrying silently", async () => {
  const fetcher = (async () => Response.json(
    { responseStatus: 429, responseDetails: "Daily request limit reached" },
    { status: 429 },
  )) as typeof fetch;

  await assert.rejects(
    translateEnglishEmail("Please translate this email.", fetcher),
    /Daily request limit reached/,
  );
});
