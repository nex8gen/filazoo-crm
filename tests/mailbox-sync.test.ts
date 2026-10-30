import assert from "node:assert/strict";
import test from "node:test";
import { mergeMailboxSnapshot, selectMailboxUids, synchronizeMailbox, type MailboxSnapshot, type MailboxSyncStore } from "../lib/mailbox-sync.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

function message(uid: number): InboxEmailItem {
  return { id: `imap-${uid}`, uid, direction: "inbound", status: "Received", subject: "Enquiry", contact: "new@buyer.test", company: "Unknown company", preview: "Hello", body: "Hello", timestamp: "2026-10-22T00:00:00Z", source: "mailbox" };
}
function memoryStore(initial: MailboxSnapshot = { messages: [] }) {
  let snapshot = initial;
  let lease: string | null = null;
  const store: MailboxSyncStore = {
    async read() { return snapshot; },
    async acquire(token) { if (lease) return false; lease = token; return true; },
    async commit(token, next) { assert.equal(token, lease); snapshot = next; lease = null; },
    async fail(token, error) { assert.equal(token, lease); snapshot = { ...snapshot, error }; lease = null; },
  };
  return store;
}

test("initial import fetches recent messages; incremental bursts drain without gaps", () => {
  const uids = Array.from({ length: 250 }, (_, i) => i + 1);
  assert.deepEqual(selectMailboxUids(uids, 100), uids.slice(-100));
  assert.deepEqual(selectMailboxUids(uids, 100, 101), uids.slice(100, 200));
  assert.deepEqual(selectMailboxUids(uids, 100, 201), uids.slice(200));
  assert.deepEqual(selectMailboxUids([250], 100, 251), []);
});

test("large history batches expose continuation without rewinding the new-mail cursor", async () => {
  const store = memoryStore({ messages: [message(1000)], cursor: { uidValidity: 1, lastUid: 1000 } });
  const snapshot = await synchronizeMailbox(store, async ({ limit, beforeUid, onMailbox, onBatch }) => {
    assert.equal(limit, 200); assert.equal(beforeUid, 1000);
    onMailbox({ uidValidity: 1, lastUid: 999 });
    onBatch({ received: 200, hasMore: true, totalMessages: 1000 });
    return Array.from({ length: 200 }, (_, i) => message(800 + i));
  }, { history: true, batchSize: 200 });
  assert.equal(snapshot.cursor?.lastUid, 1000);
  assert.equal(snapshot.messages.length, 201);
  assert.equal(snapshot.batch?.hasMore, true);
  await synchronizeMailbox(store, async ({ beforeUid, onMailbox, onBatch }) => {
    assert.equal(beforeUid, 800);
    onMailbox({ uidValidity: 1, lastUid: 799 }); onBatch({ received: 0, hasMore: false }); return [];
  }, { history: true, batchSize: 200 });
  assert.equal((await store.read()).batch?.hasMore, false);
});

test("initial sync persists unknown senders and reload reads cache without IMAP", async () => {
  const store = memoryStore();
  const first = await synchronizeMailbox(store, async ({ cursor, onMailbox, limit }) => {
    assert.equal(cursor, undefined); assert.equal(limit, 10);
    onMailbox({ uidValidity: 1, lastUid: 5 }); return [message(5)];
  });
  assert.equal(first.messages[0].contact, "new@buyer.test");
  const reload = await synchronizeMailbox(store, async () => { throw Error("Must not connect"); }, { sync: false });
  assert.deepEqual(reload, first);
});

test("incremental sync sends saved cursor and retains previously imported history", async () => {
  const store = memoryStore({ messages: [message(1)], cursor: { uidValidity: 10, lastUid: 1 } });
  const result = await synchronizeMailbox(store, async ({ cursor, onMailbox }) => {
    assert.deepEqual(cursor, { uidValidity: 10, lastUid: 1 });
    onMailbox({ uidValidity: 10, lastUid: 2 }); return [message(2)];
  });
  assert.deepEqual(result.messages.map((item) => item.uid), [2, 1]);
});

test("sync failure retains messages and checkpoint and releases its lease", async () => {
  const store = memoryStore({ messages: [message(1)], cursor: { uidValidity: 1, lastUid: 1 } });
  const result = await synchronizeMailbox(store, async () => { throw Error("Connection timeout"); });
  assert.equal(result.messages[0].uid, 1);
  assert.equal(result.cursor?.lastUid, 1);
  assert.equal(result.error, "Connection timeout");
  const retry = await synchronizeMailbox(store, async ({ onMailbox }) => {
    onMailbox({ uidValidity: 1, lastUid: 2 }); return [message(2)];
  });
  assert.equal(retry.error, null);
});

test("mailbox epoch reset replaces old UIDs instead of merging unrelated messages", () => {
  const result = mergeMailboxSnapshot({ messages: [message(7)], cursor: { uidValidity: 1, lastUid: 7 } }, [message(1)], { uidValidity: 2, lastUid: 1 });
  assert.deepEqual(result.messages.map((item) => item.uid), [1]);
});

test("overlapping requests share the database lease and do not download twice", async () => {
  const store = memoryStore();
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const first = synchronizeMailbox(store, async ({ onMailbox }) => {
    started(); await gate; onMailbox({ uidValidity: 1, lastUid: 1 }); return [message(1)];
  });
  await ready;
  await synchronizeMailbox(store, async () => { assert.fail("Second download must not start"); });
  unblock(); await first;
});

test("history import bypasses freshness and requests a bounded full scan", async () => {
  const store = memoryStore({ messages: [message(2)], cursor: { uidValidity: 1, lastUid: 2 }, syncedAt: new Date().toISOString() });
  const result = await synchronizeMailbox(store, async ({ cursor, limit, beforeUid, onMailbox }) => {
    assert.deepEqual(cursor, { uidValidity: 1, lastUid: 2 }); assert.equal(limit, 25); assert.equal(beforeUid, 2);
    onMailbox({ uidValidity: 1, lastUid: 2 }); return [message(1), message(2)];
  }, { history: true });
  assert.deepEqual(result.messages.map((item) => item.uid), [2, 1]);
});

test("older history pages never rewind the new-mail checkpoint", async () => {
  const store = memoryStore({ messages: [message(50)], cursor: { uidValidity: 1, lastUid: 50 } });
  const result = await synchronizeMailbox(store, async ({ beforeUid, onMailbox }) => {
    assert.equal(beforeUid, 50);
    onMailbox({ uidValidity: 1, lastUid: 49 }); return [message(49)];
  }, { history: true });
  assert.equal(result.cursor?.lastUid, 50);
  assert.deepEqual(result.messages.map((item) => item.uid), [50, 49]);
});

test("empty incremental result advances only the acknowledged checkpoint", async () => {
  const store = memoryStore({ messages: [message(1)], cursor: { uidValidity: 1, lastUid: 1 } });
  const result = await synchronizeMailbox(store, async ({ onMailbox }) => {
    onMailbox({ uidValidity: 1, lastUid: 1 }); return [];
  });
  assert.equal(result.messages.length, 1);
  assert.equal(result.cursor?.lastUid, 1);
});

test("empty polls keep history out of the database write while advancing the checkpoint", async () => {
  const store = memoryStore({ messages: [message(1)], cursor: { uidValidity: 1, lastUid: 1 } });
  const commit = store.commit;
  let messagesChanged: boolean | undefined;
  store.commit = async (token, snapshot, options) => {
    messagesChanged = options?.messagesChanged;
    await commit(token, snapshot, options);
  };
  const result = await synchronizeMailbox(store, async ({ onMailbox }) => {
    onMailbox({ uidValidity: 1, lastUid: 2 }); return [];
  });
  assert.equal(messagesChanged, false);
  assert.equal(result.cursor?.lastUid, 2);
  assert.equal(result.messages[0].uid, 1);
  assert.ok(result.syncedAt);
});

test("an empty mailbox after an epoch reset must replace the old message history", async () => {
  const store = memoryStore({ messages: [message(1)], cursor: { uidValidity: 1, lastUid: 1 } });
  const commit = store.commit;
  let messagesChanged: boolean | undefined;
  store.commit = async (token, snapshot, options) => {
    messagesChanged = options?.messagesChanged;
    await commit(token, snapshot, options);
  };
  const result = await synchronizeMailbox(store, async ({ onMailbox }) => {
    onMailbox({ uidValidity: 2, lastUid: 0 }); return [];
  });
  assert.equal(messagesChanged, true);
  assert.equal(result.cursor?.uidValidity, 2);
  assert.deepEqual(result.messages, []);
});

test("missing checkpoint is rejected without losing cached mail", async () => {
  const store = memoryStore({ messages: [message(1)], cursor: { uidValidity: 1, lastUid: 1 } });
  const result = await synchronizeMailbox(store, async () => [message(2)]);
  assert.match(result.error!, /checkpoint/);
  assert.deepEqual(result.messages.map((item) => item.uid), [1]);
});
