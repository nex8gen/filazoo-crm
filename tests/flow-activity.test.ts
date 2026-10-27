import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
function fixture() {
  const db: Record<string, Row[]> = {
    crm_tasks: [{ id: "mine", assigned_to: "viewer", status: "open" }, { id: "theirs", assigned_to: "other", status: "open" }],
    internal_notifications: [{ id: "mine", user_id: "viewer", read_at: null }, { id: "theirs", user_id: "other", read_at: null }],
  };
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let changes: Row | null = null, single = false, head = false;
    const query = {
      select(_columns?: string, options?: { head?: boolean }) { head = options?.head ?? false; return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query; },
      order() { return query; }, limit() { return query; }, maybeSingle() { single = true; return query; },
      update(value: Row) { changes = value; return query; }, throwOnError() { return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = db[table].filter(row => filters.every(filter => filter(row)));
        if (changes) rows.forEach(row => Object.assign(row, changes));
        return Promise.resolve({ data: head ? null : single ? rows[0] ?? null : rows, count: rows.length }).then(resolve);
      },
    };
    return query;
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-activity.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as { listFlowActivity: (summary?: boolean) => Promise<Row>; updateFlowActivity: (kind: string, id: string) => Promise<void> };
  const deps: Record<string, unknown> = { "server-only": {}, "../auth.ts": { requireWorkspaceMember: async () => ({ id: "viewer" }) }, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) } };
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name), Date });
  return { db, exports };
}

test("tasks and notifications are visible only to their assigned recipient", async () => {
  const app = fixture();
  const result = await app.exports.listFlowActivity();
  assert.equal((result.tasks as Row[]).length, 1);
  assert.equal((result.alerts as Row[]).length, 1);
  const summary = await app.exports.listFlowActivity(true);
  assert.equal(summary.openTasks, 1); assert.equal(summary.unreadAlerts, 1);
});

test("recipients can complete tasks and read alerts without modifying another user's records", async () => {
  const app = fixture();
  await app.exports.updateFlowActivity("task", "mine");
  await app.exports.updateFlowActivity("alert", "mine");
  assert.equal(app.db.crm_tasks[0].status, "done");
  assert.ok(app.db.internal_notifications[0].read_at);
  await assert.rejects(() => app.exports.updateFlowActivity("task", "theirs"), /another teammate/);
  await assert.rejects(() => app.exports.updateFlowActivity("alert", "theirs"), /another teammate/);
  assert.equal(app.db.crm_tasks[1].status, "open");
  assert.equal(app.db.internal_notifications[1].read_at, null);
});
