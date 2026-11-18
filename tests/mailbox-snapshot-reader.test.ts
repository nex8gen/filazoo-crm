import assert from "node:assert/strict";
import test from "node:test";
import { createMailboxSnapshotReader, type MailboxSnapshotRow } from "../lib/mailbox-snapshot-reader.ts";

function fixture() {
  let workspace = "workspace-a", error: { code: string; message: string } | null = null;
  const rows: MailboxSnapshotRow[] = [{ workspace_id: workspace, mailbox_key: "mailbox-a", messages_revision: "revision-a",
    messages: [{ id: "saved", subject: "Original", attachments: [{ filename: "original.pdf" }] } as MailboxSnapshotRow["messages"][number]],
    uid_validity: 1, last_uid: 100, synced_at: "2026-11-17T00:00:00Z", last_error: null, reconciled_at: null }];
  const reads: { fields: string; full: boolean; keys: string[] }[] = [];
  let beforePayload: (() => void) | undefined;
  const db = { from(table: string) {
    assert.equal(table, "mailbox_sync_state");
    return { select(fields: string) { return { in(_column: string, keys: string[]) {
      const full = fields.split(",").includes("messages");
      const run = async () => {
        reads.push({ fields, full, keys });
        if (error && (!full || error.code !== "42703")) return { data: null, error };
        if (full) beforePayload?.();
        const data = rows.filter(row => row.workspace_id === workspace && keys.includes(row.mailbox_key)).map(row => {
          const copy = structuredClone(row);
          if (!full) delete (copy as Partial<MailboxSnapshotRow>).messages;
          return copy;
        });
        return { data, error: null };
      };
      return { then: (resolve: (value: unknown) => unknown) => run().then(resolve), abortSignal: () => ({ then: (resolve: (value: unknown) => unknown) => run().then(resolve), throwOnError: async () => { const value = await run(); if (value.error) throw value.error; return value; } }),
        throwOnError: async () => { const value = await run(); if (value.error) throw value.error; return value; } };
    } }; } };
  } };
  return { db: db as unknown as Parameters<ReturnType<typeof createMailboxSnapshotReader>>[0], rows, reads,
    fail: (value: typeof error) => { error = value; }, workspace: (value: string) => { workspace = value; },
    race: (work: () => void) => { beforePayload = work; } };
}

test("unchanged mailbox polls check live metadata without downloading the message payload again", async () => {
  const f = fixture(), read = createMailboxSnapshotReader();
  assert.equal((await read(f.db, ["mailbox-a"]))[0].messages.length, 1);
  f.rows[0].last_error = "Provider delayed"; f.rows[0].synced_at = "2026-11-17T01:00:00Z";
  const next = (await read(f.db, ["mailbox-a"]))[0];
  assert.equal(next.last_error, "Provider delayed"); assert.equal(next.synced_at, f.rows[0].synced_at);
  assert.equal(f.reads.filter(row => row.full).length, 1);
  assert.equal(f.reads.filter(row => !row.full).length, 2);
});

test("flag, preview and mailbox epoch revisions refresh messages even when the last UID is unchanged", async () => {
  const f = fixture(), read = createMailboxSnapshotReader();
  await read(f.db, ["mailbox-a"]);
  f.rows[0].messages_revision = "revision-b"; f.rows[0].messages[0].subject = "Changed";
  assert.equal((await read(f.db, ["mailbox-a"]))[0].messages[0].subject, "Changed");
  assert.equal(f.reads.filter(row => row.full).length, 2);
});

test("cached payloads cannot cross workspaces or bypass revocation, deletion or database errors", async () => {
  const f = fixture(), read = createMailboxSnapshotReader();
  await read(f.db, ["mailbox-a"]);
  f.workspace("workspace-b");
  assert.deepEqual(await read(f.db, ["mailbox-a"]), []);
  f.rows.push({ ...structuredClone(f.rows[0]), workspace_id: "workspace-b", messages: [{ id: "different" } as MailboxSnapshotRow["messages"][number]] });
  assert.equal((await read(f.db, ["mailbox-a"]))[0].messages[0].id, "different");
  f.fail({ code: "42501", message: "Permission denied" });
  await assert.rejects(read(f.db, ["mailbox-a"]), /Permission denied/);
  f.fail({ code: "PGRST002", message: "Database unavailable" });
  await assert.rejects(read(f.db, ["mailbox-a"]), /Database unavailable/);
});

test("each caller receives independent messages and nested attachments", async () => {
  const f = fixture(), read = createMailboxSnapshotReader();
  const first = (await read(f.db, ["mailbox-a"]))[0];
  first.messages[0].attachments![0].filename = "mutated.pdf";
  const second = (await read(f.db, ["mailbox-a"]))[0];
  assert.equal(second.messages[0].attachments![0].filename, "original.pdf");
  second.messages[0].subject = "Also mutated";
  assert.equal((await read(f.db, ["mailbox-a"]))[0].messages[0].subject, "Original");
});

test("a concurrent update during a payload read returns and stores the new revision", async () => {
  const f = fixture(), read = createMailboxSnapshotReader();
  f.race(() => { f.rows[0].messages_revision = "race"; f.rows[0].messages[0].subject = "Fresh"; });
  assert.equal((await read(f.db, ["mailbox-a"]))[0].messages[0].subject, "Fresh");
  await read(f.db, ["mailbox-a"]);
  assert.equal(f.reads.filter(row => row.full).length, 1);
});

test("payload storage obeys byte and entry limits and older databases remain readable", async () => {
  const f = fixture(), read = createMailboxSnapshotReader({ maxBytes: 1 });
  await read(f.db, ["mailbox-a"]); await read(f.db, ["mailbox-a"]);
  assert.equal(f.reads.filter(row => row.full).length, 2);
  const bounded = createMailboxSnapshotReader({ maxEntries: 1 });
  f.rows.push({ ...structuredClone(f.rows[0]), mailbox_key: "mailbox-b" });
  await bounded(f.db, ["mailbox-a"]); await bounded(f.db, ["mailbox-b"]); await bounded(f.db, ["mailbox-a"]);
  assert.equal(f.reads.filter(row => row.full).length, 5);
  f.fail({ code: "42703", message: "Column not installed yet" });
  assert.equal((await bounded(f.db, ["mailbox-a"]))[0].messages[0].id, "saved");
});

test("empty and cancelled reads do not contact the database", async () => {
  const f = fixture(), read = createMailboxSnapshotReader();
  assert.deepEqual(await read(f.db, []), []);
  await assert.rejects(read(f.db, ["mailbox-a"], AbortSignal.abort()), { name: "AbortError" });
  assert.equal(f.reads.length, 0);
});
