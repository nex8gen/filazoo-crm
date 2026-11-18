import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as policy from "../lib/mail-import.ts";
import * as jobs from "../lib/mail-sync-jobs.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";

function fixture(preferences: policy.MailImportPreferences, folder = "INBOX") {
  const received: Record<string, unknown>[] = [];
  const mailbox = normalizeMailboxRow({ id: "m", email: "m@example.test", imap_host: "imap.example.test", imap_username: "m", imap_password: "secret", sync_preferences: policy.newMailImportPreferences })!;
  const query = { select() { return query; }, eq() { return query; }, maybeSingle() { return query; }, throwOnError: async () => ({ data: { sync_preferences: preferences, is_active: true } }) };
  const dependencies: Record<string, unknown> = {
    "node:crypto": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from: () => query }) },
    "../mailbox-utils.ts": { normalizeMailboxRow }, "../mail-sync-jobs.ts": jobs, "../mail-import.ts": policy,
    "./mailbox-sync.ts": { mailboxSyncKey: () => "a", savedProviderFolders: async () => [{ path: "Spam", kind: "spam" }], loadSyncedMailbox: async (_mailbox: unknown, options: Record<string, unknown>) => {
      received.push(options); return { error: null, messages: Array.from({ length: 500 }, (_, id) => ({ id: String(id) })), batch: { received: 0, hasMore: false, completionReason: "limit" } };
    } },
  };
  const exports = {} as { runMailSyncJob: (job: jobs.MailSyncJob, token: string, accounts: Map<string, unknown>) => Promise<{ completionReason?: string; target?: number; completed?: boolean }> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/mail-sync-worker.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Map, Date });
  const job: jobs.MailSyncJob = { id: "h", account_key: "a", kind: "history", folder, state: "running", attempts: 0, next_run_at: "", last_attempt_at: null, last_success_at: null, last_error: null };
  const accounts = new Map([ ["a", { mailbox, folders: [{ path: "Spam", kind: "spam" }], loadedAt: Date.now() }] ]);
  return { received, run: () => exports.runMailSyncJob(job, "token", accounts) };
}

test("history checks fresh pause preferences between batches, even with warm cached credentials", async () => {
  const f = fixture({ ...policy.newMailImportPreferences, historyPaused: true });
  const result = await f.run();
  assert.equal(result.completionReason, "paused");
  assert.equal(result.completed, false);
  assert.equal(f.received.length, 0);
});

test("excluded folders never start history receives", async () => {
  const f = fixture({ ...policy.newMailImportPreferences, historyFolders: "all" }, "Spam");
  assert.equal((await f.run()).completionReason, "not_selected");
  assert.equal(f.received.length, 0);
});

test("a changed history target reaches the receiver and limit completion remains distinct from provider exhaustion", async () => {
  const f = fixture({ ...policy.newMailImportPreferences, historyLimit: 1000 });
  const result = await f.run();
  assert.equal(f.received[0].historyLimit, 1000);
  assert.equal(result.target, 1000);
  assert.equal(result.completionReason, "limit");
  assert.equal(result.completed, false);
});
