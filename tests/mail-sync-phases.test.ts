import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash, webcrypto } from "node:crypto";
import * as sync from "../lib/mailbox-sync.ts";
import * as content from "../lib/email-content.ts";
import * as mime from "../lib/email-mime.ts";

test("preview and flag failures cannot erase committed new mail or change its successful check time", async () => {
  const message = (uid: number) => ({ id: `imap-${uid}`, uid, uidValidity: 1, contact: "buyer@test", body: "", preview: "", timestamp: new Date().toISOString() });
  const state: Record<string, unknown> = { mailbox_key: "fixture", messages: [message(1)], uid_validity: 1, last_uid: 1, synced_at: new Date(Date.now() - 600_000).toISOString(), last_error: null };
  function from() {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let patch: Record<string, unknown> | null = null;
    const query = {
      select() { return query; }, maybeSingle() { return query; }, throwOnError() { return query; }, or() { return query; },
      eq(column: string, value: unknown) { if (column !== "mailbox_key") filters.push((row) => row[column] === value); return query; },
      upsert() { return query; }, update(value: Record<string, unknown>) { patch = value; return query; },
      then(resolve: (value: unknown) => unknown) {
        const matched = filters.every((filter) => filter(state));
        if (matched && patch) Object.assign(state, patch);
        return Promise.resolve({ data: matched ? { ...state } : null, error: null }).then(resolve);
      },
    };
    return query;
  }
  let headerCalls = 0;
  const dependencies: Record<string, unknown> = {
    "node:crypto": { createHash },
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) },
    "../mailbox-sync.ts": sync,
    "../email-content.ts": content,
    "../email-mime.ts": mime,
    "../email-inbox.ts": { fetchMailboxInboxMessages: async (_mailbox: unknown, options: { uids?: number[]; includePreview?: boolean; onMailbox: (cursor: sync.MailboxCursor) => void }) => {
      if (options.uids) throw new Error("Preview timed out");
      headerCalls++;
      assert.equal(options.includePreview, false);
      options.onMailbox({ uidValidity: 1, lastUid: 2 });
      return [message(2)];
    } },
    "../mailbox-imap.ts": { reconcileMailboxMessages: async () => { throw new Error("Flags timed out"); } },
  };
  const exports = {} as { loadSyncedMailbox: (mailbox: unknown, options: Record<string, unknown>) => Promise<{ error: string | null; messages: Array<{ uid: number }> }> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/mailbox-sync.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, crypto: webcrypto, Date, Map, console });
  const options = { sync: true, includeContent: false };
  assert.equal((await exports.loadSyncedMailbox({ id: "test" }, { ...options, phase: "headers" })).error, null);
  const checkedAt = state.synced_at;
  assert.equal(state.last_uid, 2);
  for (const phase of ["previews", "flags"]) {
    const result = await exports.loadSyncedMailbox({ id: "test" }, { ...options, phase });
    assert.match(result.error!, /timed out/);
    assert.equal(result.messages.length, 2);
    assert.equal(state.last_uid, 2);
    assert.equal(state.synced_at, checkedAt);
    assert.equal(state.last_error, null);
  }
  assert.equal(headerCalls, 1);
});
