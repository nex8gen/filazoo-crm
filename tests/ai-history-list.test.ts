import test from "node:test";
import assert from "node:assert/strict";
import { createHistoryListCache, type HistoryListQuery } from "../lib/ai/history-list-cache.ts";
import type { Conversation } from "../lib/ai/chat-history.ts";

const query: HistoryListQuery = { scope: "scope-a", all: true, search: "", archived: false };
const conversation = (id: string): Conversation => ({ id, mode: "chat", pathname: "/companies", title: `Title ${id}`, version: 1, summary: "", pinned: false, archived: false, updated_at: "2026-11-06T00:00:00Z" });
const page = (items = [conversation("a")], hasMore = false, offset = 30) => Response.json({ conversations: items, hasMore, offset });

test("history does no work until requested and deduplicates title reads across modes and remounts", async () => {
  let calls = 0;
  let release: (response: Response) => void = () => {};
  const cache = createHistoryListCache(async (url) => {
    calls++;
    assert.equal(new URL(String(url), "http://localhost").searchParams.get("titles"), "true");
    assert.ok(!String(url).includes("resume="));
    return new Promise(resolve => { release = resolve; });
  });
  assert.equal(calls, 0);
  const initial = cache.load(query);
  const duplicate = cache.load({ ...query, scope: "another-page-and-mode" });
  assert.equal(calls, 1);
  release(page());
  await Promise.all([initial, duplicate]);
  assert.equal(cache.read(query).items[0].title, "Title a");
  await cache.load(query);
  assert.equal(calls, 1, "fresh titles are available synchronously without another request");
  cache.dispose();
});

test("stale title lists stay visible during revalidation and transient failures", async () => {
  let clock = 1, fail = false;
  let release: (response: Response) => void = () => {};
  const cache = createHistoryListCache(async () => {
    if (fail) return new Response(null, { status: 503 });
    if (clock === 1) return page();
    return new Promise(resolve => { release = resolve; });
  }, () => clock);
  await cache.load(query);
  clock += 31_000;
  const refresh = cache.load(query);
  assert.equal(cache.read(query).loading, true);
  assert.equal(cache.read(query).items[0].id, "a");
  release(page([conversation("b")])); await refresh;
  fail = true; clock += 31_000;
  await cache.load(query);
  assert.equal(cache.read(query).items[0].id, "b");
  assert.match(cache.read(query).error!.message, /temporarily unavailable/);
  cache.dispose();
});

test("searches, archived lists and record scopes never display another query's titles", async () => {
  const cache = createHistoryListCache(async () => page());
  await cache.load(query);
  for (const other of [{ ...query, search: "invoice" }, { ...query, archived: true }, { ...query, all: false }, { ...query, all: false, scope: "different" }]) assert.equal(cache.read(other).items.length, 0);
  cache.dispose();
});

test("archiving and deleting update cached titles immediately and cancelled reads cannot resurrect them", async () => {
  let release: (response: Response) => void = () => {};
  let calls = 0;
  const cache = createHistoryListCache(async () => ++calls === 1 ? page() : new Promise(resolve => { release = resolve; }));
  await cache.load(query);
  const stale = cache.load(query, true);
  cache.change("a", { archived: true });
  assert.equal(cache.read(query).items.length, 0);
  release(page()); await stale;
  assert.equal(cache.read(query).items.length, 0);
  cache.dispose();
});

test("pagination retains titles and authentication failures clear every cached list", async () => {
  let expired = false;
  const cache = createHistoryListCache(async url => expired ? new Response(null, { status: 401 }) : new URL(String(url), "http://localhost").searchParams.get("offset") === "30" ? page([conversation("a"), conversation("b")], false, 60) : page(undefined, true));
  await cache.load(query);
  await cache.load(query, false, true);
  assert.deepEqual(cache.read(query).items.map(item => item.id), ["a", "b"]);
  expired = true;
  await cache.load({ ...query, archived: true });
  assert.equal(cache.read(query).items.length, 0);
  assert.equal(cache.read(query).error?.message.includes("session has expired"), true);
  cache.dispose();
});
