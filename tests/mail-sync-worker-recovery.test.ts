import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as jobs from "../lib/mail-sync-jobs.ts";

test("overlapping cron ticks share one warm worker and release only their own lease", async () => {
  let owner: string | null = null;
  const db = { from: (table: string) => {
    assert.equal(table, "mailbox_sync_state");
    return {
      upsert: () => ({ throwOnError: async () => ({}) }),
      update: (patch: { lease_token: string | null }) => ({ eq: (_column: string, key: string) => {
        assert.equal(key, "system:mail-sync-worker");
        return {
          or: (condition: string) => { assert.match(condition, /lease_until\.is\.null,lease_until\.lt\./); return { select: () => ({ maybeSingle: () => ({ throwOnError: async () => {
            if (owner) return { data: null }; owner = patch.lease_token; return { data: { mailbox_key: key } };
          } }) }) }; },
          eq: (_field: string, token: string) => ({ throwOnError: async () => { if (owner === token) owner = patch.lease_token; } }),
        };
      } }),
    };
  } };
  const exports = {} as { withMailSyncWorkerLease: (run: () => Promise<unknown>) => Promise<unknown> };
  const dependencies: Record<string, unknown> = { "node:crypto": { randomUUID }, "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "../mailbox-utils.ts": {}, "../mail-sync-jobs.ts": jobs, "./mailbox-sync.ts": {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/mail-sync-worker.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Map, Date });
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const first = exports.withMailSyncWorkerLease(async () => { started(); await new Promise<void>(resolve => { release = resolve; }); return "done"; });
  await ready;
  const skipped = await exports.withMailSyncWorkerLease(async () => { throw new Error("must not start a competing worker"); });
  assert.equal(JSON.stringify(skipped), JSON.stringify({ alreadyRunning: true }));
  release(); assert.equal(await first, "done"); assert.equal(owner, null);
  await exports.withMailSyncWorkerLease(async () => { owner = "replacement-owner"; });
  assert.equal(owner, "replacement-owner", "an old worker cannot release a replacement lease");
});

test("ambiguous claim failures release only their token so the next tick can recover immediately", async () => {
  const claimed: string[] = [], released: string[] = [];
  const db = {
    rpc(_name: string, input: { p_token: string }) { claimed.push(input.p_token); return { throwOnError: async () => { throw new Error("fetch failed"); } }; },
    from(table: string) {
      assert.equal(table, "mail_sync_accounts");
      return { update: (patch: unknown) => { assert.equal(JSON.stringify(patch), JSON.stringify({ lease_token: null, lease_until: null })); return { eq: (column: string, token: string) => {
        assert.equal(column, "lease_token"); released.push(token); return { throwOnError: async () => ({ data: null }) };
      } }; } };
    },
  };
  const exports = {} as { runMailSyncWorker: (options: unknown) => Promise<unknown> };
  const dependencies: Record<string, unknown> = {
    "node:crypto": { randomUUID }, "../supabase/admin.ts": { createSupabaseAdmin: () => db },
    "../mailbox-utils.ts": {}, "../mail-sync-jobs.ts": jobs, "./mailbox-sync.ts": {},
    "../mailbox-imap.ts": { withMailboxSyncSessions: async (run: () => Promise<unknown>) => run() },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/mail-sync-worker.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Map, Date, setTimeout, setInterval, clearInterval });
  await assert.rejects(exports.runMailSyncWorker({ seed: false, maxJobs: 1, budgetMs: 60_000 }), /fetch failed/);
  assert.equal(claimed.length, 4);
  assert.deepEqual([...released].sort(), [...claimed].sort());
});
