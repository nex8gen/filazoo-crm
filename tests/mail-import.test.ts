import assert from "node:assert/strict";
import test from "node:test";
import { connectionImportPreferences, parseMailImportPreferences, readMailImportPreferences, historyFolderSelected, importTimeEstimate } from "../lib/mail-import.ts";
import { mailSyncHealth, type MailSyncJob } from "../lib/mail-sync-jobs.ts";

test("new connections use a bounded initial scope; old forms cannot overwrite existing preferences", () => {
  assert.deepEqual(connectionImportPreferences(new FormData(), false), { historyLimit: 500, historyFolders: "inbox_sent", historyPaused: false });
  assert.equal(connectionImportPreferences(new FormData(), true), undefined);
  assert.equal(readMailImportPreferences(null).historyLimit, 5000);
  const form = new FormData(); form.set("syncPreferences", JSON.stringify({ historyLimit: 1000, historyFolders: "all", historyPaused: false }));
  assert.equal(connectionImportPreferences(form, false)?.historyLimit, 1000);
  form.set("syncPreferences", JSON.stringify({ historyLimit: 100000, historyFolders: "all", historyPaused: false }));
  assert.throws(() => connectionImportPreferences(form, false));
});

test("forged policies are rejected, and spam/trash history stays excluded", () => {
  for (const value of [null, {}, { historyLimit: "500", historyFolders: "all", historyPaused: false }, { historyLimit: 500, historyFolders: "all", historyPaused: "false" }, { historyLimit: 500, historyFolders: "other", historyPaused: false }]) assert.throws(() => parseMailImportPreferences(value));
  const selected = { historyLimit: 500, historyFolders: "inbox_sent" as const, historyPaused: false };
  assert.equal(historyFolderSelected(selected, "inbox"), true);
  assert.equal(historyFolderSelected(selected, "sent"), true);
  assert.equal(historyFolderSelected(selected, "archive"), false);
  assert.equal(historyFolderSelected({ ...selected, historyFolders: "all" }, "spam"), false);
  assert.equal(historyFolderSelected({ ...selected, historyFolders: "all" }, "trash"), false);
});

test("time estimates require observed throughput and use a range instead of a promise", () => {
  assert.equal(importTimeEstimate(500, 0, 0), null);
  assert.equal(importTimeEstimate(500, 10, 5000), null);
  assert.equal(importTimeEstimate(0, 100, 10000), null);
  assert.equal(importTimeEstimate(100, 200, 10000), "About a minute remaining");
  assert.equal(importTimeEstimate(1000, 100, 60000), "About 7–15 minutes remaining");
});

test("legacy 5000-of-19000 completion is shown as limited, while real provider exhaustion is complete", () => {
  const job: MailSyncJob = { id: "h", account_key: "a", kind: "history", folder: "INBOX", state: "idle", attempts: 0, next_run_at: "2026-11-18T00:00:00Z", last_attempt_at: null, last_success_at: null, last_error: null, progress: { imported: 5000, totalMessages: 19000, completed: true } };
  assert.equal(mailSyncHealth([job]).historyReason, "limit");
  assert.equal(mailSyncHealth([job]).historyComplete, false);
  job.progress = { imported: 500, totalMessages: 500, completed: true, completionReason: "complete" };
  assert.equal(mailSyncHealth([job]).historyComplete, true);
  assert.equal(mailSyncHealth([job]).historyReason, "complete");
});
