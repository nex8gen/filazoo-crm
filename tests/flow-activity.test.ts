import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as autoReply from "../lib/email-auto-reply.ts";
import * as activity from "../lib/task-activity.ts";

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
function fixture(role = "operator") {
  const db: Record<string, Row[]> = {
    email_auto_replies: [],
    crm_tasks: [{ id: "mine", assigned_to: "viewer", status: "open" }, { id: "theirs", assigned_to: "other", status: "open" }],
    internal_notifications: [{ id: "mine", user_id: "viewer", read_at: null }, { id: "theirs", user_id: "other", read_at: null }],
  };
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let changes: Row | null = null, single = false, head = false;
    let start = 0, end = Number.POSITIVE_INFINITY;
    const ordering: Array<{ key: string; ascending: boolean; nullsFirst: boolean }> = [];
    const query = {
      select(_columns?: string, options?: { head?: boolean }) { head = options?.head ?? false; return query; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query; },
      order(key: string, options?: { ascending?: boolean; nullsFirst?: boolean }) { ordering.push({ key, ascending: options?.ascending ?? true, nullsFirst: options?.nullsFirst ?? false }); return query; },
      range(from: number, to: number) { start = from; end = to; return query; }, maybeSingle() { single = true; return query; },
      update(value: Row) { changes = value; return query; }, throwOnError() { return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = db[table].filter(row => filters.every(filter => filter(row)));
        if (changes) rows.forEach(row => Object.assign(row, changes));
        rows.sort((a, b) => {
          for (const order of ordering) {
            const x = order.key === "is_unread" ? a.read_at == null : a[order.key], y = order.key === "is_unread" ? b.read_at == null : b[order.key];
            if (x === y) continue;
            if (x == null) return order.nullsFirst ? -1 : 1;
            if (y == null) return order.nullsFirst ? 1 : -1;
            return (String(x) < String(y) ? -1 : 1) * (order.ascending ? 1 : -1);
          }
          return 0;
        });
        return Promise.resolve({ data: head ? null : single ? rows[0] ?? null : rows.slice(start, end + 1), count: rows.length }).then(resolve);
      },
    };
    return query;
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-activity.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as { listFlowActivity: (summary?: boolean, pages?: { taskPage: number; alertPage: number; taskId?: string }) => Promise<Row>; updateFlowActivity: (kind: string, id: string) => Promise<void> };
  const deps: Record<string, unknown> = { "server-only": {}, "../task-activity.ts": activity, "../auth.ts": { requireWorkspaceMember: async () => ({ id: "viewer", role }) }, "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) } };
  deps["../email-auto-reply.ts"] = autoReply;
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

test("unread alerts stay reachable ahead of newer read history and all pages are available", async () => {
  const app = fixture();
  app.db.internal_notifications = Array.from({ length: 115 }, (_, i) => ({ id: String(i).padStart(3, "0"), user_id: "viewer", read_at: "2026-10-29", created_at: "2026-10-29" }));
  app.db.internal_notifications.push({ id: "old-unread", user_id: "viewer", read_at: null, created_at: "2026-01-01" });
  app.db.crm_tasks = Array.from({ length: 105 }, (_, i) => ({ id: String(i).padStart(3, "0"), assigned_to: "viewer", status: "open", due_at: i === 0 ? null : `2099-01-${String(i).padStart(3, "0")}` }));
  const first = await app.exports.listFlowActivity();
  assert.equal((first.alerts as Row[])[0].id, "old-unread");
  assert.equal((first.tasks as Row[]).length, 100); assert.equal(first.taskCount, 105);
  assert.notEqual((first.tasks as Row[])[0].id, "000", "Undated work must follow dated tasks");
  const second = await app.exports.listFlowActivity(false, { taskPage: 1, alertPage: 1 });
  assert.equal((second.tasks as Row[]).length, 5); assert.equal((second.alerts as Row[]).length, 16);
  assert.equal(new Set([...(first.tasks as Row[]), ...(second.tasks as Row[])].map(row => row.id)).size, 105);
});

test("task links can load closed or off-page work only for its recipient", async () => {
  const app = fixture();
  app.db.crm_tasks[0].status = "done";
  const result = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId: "mine" });
  assert.equal((result.focusedTask as Row).status, "done");
  assert.equal((await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId: "theirs" })).focusedTask, null);
});

test("read-only members can read their alerts but cannot complete tasks; cancelled tasks stay cancelled", async () => {
  const app = fixture("viewer");
  await assert.rejects(() => app.exports.updateFlowActivity("task", "mine"), /read-only/);
  await app.exports.updateFlowActivity("alert", "mine");
  assert.ok(app.db.internal_notifications[0].read_at);
  const writer = fixture(); writer.db.crm_tasks[0].status = "cancelled";
  await assert.rejects(() => writer.exports.updateFlowActivity("task", "mine"), /unavailable/);
  assert.equal(writer.db.crm_tasks[0].status, "cancelled");
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
