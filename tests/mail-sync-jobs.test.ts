import assert from "node:assert/strict";
import test from "node:test";
import { mailSyncHealth, mailSyncRetrySeconds, mailSyncBatchSize, type MailSyncJob } from "../lib/mail-sync-jobs.ts";

const now = Date.parse("2026-10-30T03:00:00Z");
function job(overrides: Partial<MailSyncJob> = {}): MailSyncJob {
  return { id: "job", account_key: "account", kind: "inbox", folder: "INBOX", state: "queued", attempts: 0,
    next_run_at: new Date(now + 30_000).toISOString(), last_attempt_at: new Date(now - 10_000).toISOString(),
    last_success_at: new Date(now - 60_000).toISOString(), last_error: null, ...overrides };
}
test("transient failures back off exponentially with bounded jitter", () => {
  assert.equal(mailSyncRetrySeconds(0, 0), 30);
  assert.equal(mailSyncRetrySeconds(1, 0), 60);
  assert.equal(mailSyncRetrySeconds(2, 0), 120);
  assert.equal(mailSyncRetrySeconds(100, 1), 1815);
});

test("slow provider retries reduce only the failing batch while new-mail checks stay large", () => {
  assert.deepEqual([0, 1, 2, 5].map((attempt) => mailSyncBatchSize("history", attempt)), [200, 50, 25, 25]);
  assert.deepEqual([0, 1, 2, 5].map((attempt) => mailSyncBatchSize("previews", attempt)), [25, 10, 1, 1]);
  assert.equal(mailSyncBatchSize("inbox", 3), 100);
  assert.equal(mailSyncBatchSize("history", 0, 50), 50, "successful retries must retain their working batch size");
  assert.equal(mailSyncBatchSize("previews", 0, 1), 1);
  assert.equal(mailSyncBatchSize("inbox", 0, 1), 100);
  assert.equal(mailSyncBatchSize("history", 0, -1), 200);
});
test("a failed history or Trash job cannot change Inbox freshness", () => {
  const result = mailSyncHealth([job(), job({ kind: "history", last_error: "Timeout" }), job({ kind: "folder", folder: "Trash", last_error: "Timeout" })], null, now);
  assert.equal(result.state, "up_to_date");
  assert.equal(result.history, "retrying");
});
test("freshness reflects last successful check and authentication separately", () => {
  assert.equal(mailSyncHealth([], null, now).state, "waiting");
  assert.equal(mailSyncHealth([job({ state: "running" })], null, now).state, "checking");
  assert.equal(mailSyncHealth([job({ last_success_at: new Date(now - 600_000).toISOString() })], null, now).state, "stale");
  assert.equal(mailSyncHealth([job({ last_error: "Mailbox operation timed out" })], null, now).state, "retrying");
  assert.equal(mailSyncHealth([job({ last_error: "Authentication failed" })], null, now).state, "reconnect_required");
});
test("a crashed worker is never advertised as still checking", () => {
  const result = mailSyncHealth([job({ state: "running", last_attempt_at: new Date(now - 600_000).toISOString(), last_success_at: null })], null, now);
  assert.equal(result.state, "waiting");
});
test("folder status is isolated and a finished history job stops the progress indicator", () => {
  const result = mailSyncHealth([job({ last_error: "Timeout" }), job({ kind: "folder", folder: "Sent" }), job({ kind: "history", folder: "Sent", state: "idle" })], null, now, "Sent");
  assert.equal(result.state, "up_to_date");
  assert.equal(result.history, "idle");
});
