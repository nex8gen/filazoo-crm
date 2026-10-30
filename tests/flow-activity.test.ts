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
    crm_task_workflows: [],
    companies: [],
    workspace_members: [{ user_id: "viewer", display_name: "Current user" }, { user_id: "other", display_name: "Teammate" }],
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
      or(value: string) { const terms = value.split(",").map(term => { const [key, , ...rest] = term.split("."); return { key, value: rest.join(".") }; }); filters.push(row => terms.some(term => row[term.key] === term.value)); return query; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
      is(key: string, value: unknown) { filters.push(row => (row[key] ?? null) === value); return query; },
      lt(key: string, value: string) { filters.push(row => row[key] != null && String(row[key]) < value); return query; },
      gte(key: string, value: string) { filters.push(row => row[key] != null && String(row[key]) >= value); return query; },
      ilike(key: string, value: string) {
        const literal = value.slice(1, -1).replace(/\\([\\%_])/g, "$1").toLowerCase();
        filters.push(row => String(row[key] ?? "").toLowerCase().includes(literal)); return query;
      },
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
  const exports = {} as { listFlowActivity: (summary?: boolean, pages?: activity.ActivityListOptions) => Promise<Row>; updateFlowActivity: (kind: string, id: string) => Promise<void> };
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

test("prepared work is batched into visible tasks and alerts without including its private payload", async () => {
  const app = fixture();
  app.db.crm_task_workflows = [{ task_id: "mine", kind: "invoice_review", status: "ready", invoice_id: "invoice-mine", revision: 3 }, { task_id: "theirs", kind: "email_follow_up", status: "ready", revision: 2 }];
  app.db.internal_notifications[0].task_id = "mine";
  const result = await app.exports.listFlowActivity();
  const mine = (result.tasks as Row[])[0].workflow as Row;
  assert.equal(mine.kind, "invoice_review"); assert.equal(mine.revision, 3);
  assert.equal("payload" in mine, false);
  assert.equal(((result.alerts as Row[])[0].workflow as Row).invoice_id, "invoice-mine");
});

test("work inbox filters search the full recipient scope before pagination and keep global counts", async () => {
  const app = fixture();
  const day = activity.activityDayBounds(new Date());
  app.db.crm_tasks = Array.from({ length: 105 }, (_, i) => ({ id: String(i), assigned_to: "viewer", status: "open", title: i === 104 ? "Buyer 100%_match" : "Other work", due_at: "2099-12-31T12:00:00Z" }));
  app.db.crm_tasks.push({ id: "done", assigned_to: "viewer", title: "Completed follow-up", status: "done", completed_at: "2026-10-29T01:00:00Z", due_at: null });
  app.db.crm_tasks.push({ id: "overdue", assigned_to: "viewer", title: "Call buyer", status: "open", due_at: "2001-01-01T00:00:00Z" });
  app.db.crm_tasks.push({ id: "today", assigned_to: "viewer", title: "Today's follow-up", status: "open", due_at: day.start });
  const found = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, query: "100%_match" });
  assert.equal((found.tasks as Row[]).length, 1); assert.equal((found.tasks as Row[])[0].id, "104");
  assert.equal((found.summary as Row).openTasks, 107);
  assert.equal((await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskView: "completed" })).taskCount, 1);
  assert.equal((await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskView: "today" })).taskCount, 1);
  const overdue = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskView: "overdue" });
  assert.ok((overdue.tasks as Row[]).some(row => row.id === "overdue"));
  app.db.internal_notifications.push({ id: "read", user_id: "viewer", read_at: new Date().toISOString() });
  const unread = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, alertView: "unread" });
  assert.equal(unread.alertCount, 1);
});

test("task groups use the CRM timezone, preserve private notes and hide internal linkage markers", () => {
  const now = new Date("2026-10-29T15:59:00Z");
  assert.deepEqual(activity.activityDayBounds(now), { start: "2026-10-28T16:00:00.000Z", end: "2026-10-29T16:00:00.000Z" });
  const task = { id: "task", title: "Follow-up", priority: "normal", updated_at: "", notes: "Customer context", company_id: null, due_at: null, status: "open" };
  assert.equal(activity.taskDueGroup(task, now), "No due date");
  assert.equal(activity.taskDueGroup({ ...task, due_at: "2026-10-29T15:59:30Z" }, now), "Today");
  assert.equal(activity.taskDueGroup({ ...task, due_at: "2026-10-29T16:00:00Z" }, now), "Upcoming");
  assert.equal(activity.taskDueGroup({ ...task, status: "done" }, now), "Completed");
  assert.equal(activity.taskNotes(task), "Customer context");
  assert.equal(activity.taskNotes({ ...task, notes: "Company purchase analysis: internal-product-key" }), "");
  assert.equal(activity.taskSource({ ...task, automation_id: "auto" }), "AI email review");
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
  const preview = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, preview: true });
  assert.equal((preview.tasks as Row[]).length, 5); assert.equal((preview.alerts as Row[]).length, 5);
  assert.equal(preview.taskCount, 105, "The header preview must retain the global task total");
});

test("task links can load closed or off-page work only for its recipient", async () => {
  const app = fixture();
  app.db.crm_tasks[0].status = "done";
  const result = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId: "mine" });
  assert.equal((result.focusedTask as Row).status, "done");
  assert.equal((await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId: "theirs" })).focusedTask, null);
});

test("assigned-by-me work stays visible to its creator while unrelated tasks and members remain private", async () => {
  const app = fixture();
  app.db.crm_tasks.push({ id: "delegated", assigned_to: "other", assigned_by: "viewer", created_by: "viewer", status: "open" });
  app.db.crm_tasks.push({ id: "unassigned", assigned_to: null, assigned_by: "viewer", created_by: "viewer", status: "open" });
  const delegated = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskScope: "delegated" });
  assert.deepEqual(Array.from(delegated.tasks as Row[], row => row.id).sort(), ["delegated", "unassigned"]);
  assert.equal((delegated.tasks as Row[])[0].assignee_name, "Teammate");
  const mine = await app.exports.listFlowActivity();
  assert.equal((mine.tasks as Row[]).length, 1);
  const focused = await app.exports.listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId: "delegated" });
  assert.equal((focused.focusedTask as Row).id, "delegated");
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
