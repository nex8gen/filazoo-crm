import assert from "node:assert/strict";
import test from "node:test";
import { createPageCache } from "../lib/page-cache.ts";

test("visited pages and identical in-flight requests never repeat their read", async () => {
  const cache = createPageCache("first", [1]);
  let calls = 0, resolve!: (value: number[]) => void;
  const read = () => { calls++; return new Promise<number[]>(done => { resolve = done; }); };
  assert.deepEqual(await cache.load("first", read), [1]);
  assert.equal(calls, 0);
  const second = cache.load("second", read);
  assert.equal(cache.load("second", read), second);
  resolve([2]); await second;
  assert.deepEqual(await cache.load("second", read), [2]);
  assert.equal(calls, 1);
});

test("failed reads retry and invalidation prevents older requests repopulating the cache", async () => {
  const cache = createPageCache("first", 1);
  await assert.rejects(cache.load("second", async () => { throw new Error("offline"); }), /offline/);
  assert.equal(await cache.load("second", async () => 2), 2);
  let resolve!: (value: number) => void;
  const old = cache.load("third", () => new Promise<number>(done => { resolve = done; }));
  cache.clear(); resolve(3); await old;
  assert.equal(cache.has("third"), false);
  assert.equal(cache.has("first"), false);
  assert.equal(await cache.load("third", async () => 4), 4);
});

test("page keys separate mailboxes and filtered views; edited messages can be remembered", async () => {
  const cache = createPageCache("mine:inbox:1", { read: false });
  cache.set("mine:inbox:1", { read: true });
  assert.deepEqual(await cache.load("mine:inbox:1", async () => ({ read: false })), { read: true });
  assert.equal(cache.has("team:inbox:1"), false);
  assert.equal(cache.has("mine:sent:1"), false);
});
