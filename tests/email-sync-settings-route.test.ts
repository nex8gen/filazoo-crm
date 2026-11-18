import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as policy from "../lib/mail-import.ts";
import { validProviderFolder } from "../lib/email-provider.ts";

function fixture(options: { role?: string; type?: string; owner?: string; queueFails?: boolean; active?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [], filters: Record<string, unknown> = {}, queued: unknown[] = [], background: unknown[] = [];
  const viewer = { id: "me", role: options.role || "admin" };
  const mailbox = { id: "mine", userId: options.owner || "me", type: options.type || "personal", isActive: options.active !== false, syncPreferences: policy.newMailImportPreferences };
  const query = {
    update(value: Record<string, unknown>) { writes.push(value); return query; },
    eq(key: string, value: unknown) { filters[key] = value; return query; },
    select() { return query; }, maybeSingle: async () => ({ data: { id: "mine" }, error: null }),
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => viewer },
    "@/lib/workspace-context": { withWorkspaceViewer: (_viewer: unknown, run: () => unknown) => run() },
    "@/lib/mail-import": policy, "@/lib/email-provider": { validProviderFolder },
    "@/lib/data/mailboxes": { getViewerMailbox: async (_userId: string, id: string) => id === "mine" ? mailbox : null, mailboxHasImap: () => mailbox.isActive },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => query }) },
    "@/lib/data/mail-sync-worker": {
      readMailboxSyncHealth: async () => ({ state: "up_to_date", history: "idle" }),
      enqueueMailboxSync: async (...args: unknown[]) => { if (options.queueFails) throw new Error("Offline"); queued.push(args); },
      runMailSyncWorker: async () => {}, withMailSyncWorkerLease: (run: () => unknown) => run(),
    },
    "next/server": { after: (run: unknown) => background.push(run) },
  };
  const exports = {} as { GET: (r: Request) => Promise<Response>; POST: (r: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/sync/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; }, URL, Response, Date });
  const post = (body: Record<string, unknown>) => exports.POST(new Request("http://localhost/api/email/sync", { method: "POST", body: JSON.stringify({ mailboxId: "mine", operation: "configure", preferences: policy.newMailImportPreferences, ...body }) }));
  return { ...exports, post, writes, filters, queued, background };
}

test("status-only checks neither enqueue nor start provider operations", async () => {
  const f = fixture();
  const response = await f.GET(new Request("http://localhost/api/email/sync?mailboxId=mine"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).health.state, "up_to_date");
  assert.equal(f.writes.length + f.queued.length + f.background.length, 0);
  assert.equal((await f.GET(new Request("http://localhost/api/email/sync?mailboxId=another-user"))).status, 404);
});

test("history changes preserve sending/new-mail settings and enforce owner/admin permissions", async () => {
  for (const options of [{ owner: "someone-else" }, { type: "workspace", role: "viewer" }, { type: "workspace", role: "operator" }]) {
    const f = fixture(options);
    assert.equal((await f.post({})).status, 403);
    assert.equal(f.writes.length + f.queued.length, 0);
  }
  const f = fixture({ role: "viewer" });
  assert.equal((await f.post({ operation: "pause" })).status, 200);
  assert.equal((f.writes[0].sync_preferences as policy.MailImportPreferences).historyPaused, true);
  assert.equal("is_active" in f.writes[0], false);
  assert.equal(f.filters.user_id, "me");
  assert.equal(f.queued.length + f.background.length, 0);
});

test("invalid limits and stopped connections cannot start receiving", async () => {
  const invalid = fixture();
  assert.equal((await invalid.post({ preferences: { ...policy.newMailImportPreferences, historyLimit: 5001 } })).status, 400);
  assert.equal(invalid.writes.length, 0);
  const pausedAccount = fixture({ active: false });
  assert.equal((await pausedAccount.post({})).status, 409);
  assert.equal(pausedAccount.queued.length + pausedAccount.writes.length, 0);
});

test("success follows durable queuing; a failed queue never becomes a loading success", async () => {
  const f = fixture();
  const response = await f.post({ preferences: { historyLimit: 1000, historyFolders: "inbox_sent", historyPaused: false } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).queued, true);
  assert.equal(f.queued.length, 1);
  assert.equal(f.background.length, 1);
  const failed = fixture({ queueFails: true });
  const failure = await failed.post({});
  assert.equal(failure.status, 503);
  assert.match((await failure.json()).error, /saved.*could not be queued/);
  assert.equal(failed.background.length, 0);
});
