import assert from "node:assert/strict";
import test from "node:test";
import { buildMyDay, type MyDayInputs, type MyDayTask } from "../lib/my-day.ts";

const now = new Date("2026-10-30T08:00:00Z");
const task = (id: string, changes: Partial<MyDayTask> = {}): MyDayTask => ({ id, title: id, company_id: null, company_name: null, priority: "normal", due_at: null, status: "open", ...changes });
const input = (changes: Partial<MyDayInputs> = {}): MyDayInputs => ({ tasks: [], followups: [], invoices: [], replies: [], ...changes });

test("My Day orders overdue, today, attention and future work with high priority inside each group", () => {
  const items = buildMyDay(input({ tasks: [task("later", { due_at: "2026-10-31T01:00:00Z" }), task("undated"), task("today", { due_at: "2026-10-30T09:00:00Z" }), task("overdue-normal", { due_at: "2026-10-29T09:00:00Z" }), task("overdue-high", { due_at: "2026-10-30T07:00:00Z", priority: "high" }), task("done", { status: "done" })] }), now);
  assert.deepEqual(items.map(item => item.id), ["task:overdue-high", "task:overdue-normal", "task:today", "task:undated", "task:later"]);
});
test("My Day uses the UTC+8 day boundary regardless of server timezone", () => {
  const items = buildMyDay(input({ tasks: [task("today", { due_at: "2026-10-30T15:59:59Z" }), task("tomorrow", { due_at: "2026-10-30T16:00:00Z" })] }), now);
  assert.deepEqual(items.map(item => item.urgency), ["today", "upcoming"]);
});
test("My Day deduplicates company reminders and customer reply tasks", () => {
  const items = buildMyDay(input({ tasks: [task("t", { company_id: "c", notes: "Scheduled from intelligent next follow-up recommendation." })], followups: [{ company_id: "c", company_name: "Customer", due_at: "2026-10-29T09:00:00Z" }], replies: [{ id: "r", company_name: "Customer", task_id: "t", task_status: "open", status: "received", expires_at: "2026-10-31T00:00:00Z" }] }), now);
  assert.equal(items.length, 1); assert.equal(items[0].kind, "reply"); assert.equal(items[0].href, "/tasks?task=t");
});
test("My Day displays only issued unpaid invoices due today or earlier and keeps currencies separate", () => {
  const base = { id: "i", number: 1, company_name: "Customer", due_date: "2026-10-30", currency: "CNY", total_minor: 20000, paid_minor: 5000, status: "issued" };
  const items = buildMyDay(input({ invoices: [base, base, { ...base, id: "draft", status: "draft" }, { ...base, id: "paid", paid_minor: 20000 }, { ...base, id: "future", due_date: "2026-10-31" }, { ...base, id: "usd", currency: "USD", due_date: "2026-10-29" }] }), now);
  assert.equal(items.length, 2);
  assert.equal(items[0].urgency, "overdue");
  assert.deepEqual(items.map(item => item.amount), [{ minor: 15000, currency: "USD" }, { minor: 15000, currency: "CNY" }]);
  assert.equal(items[1].urgency, "today");
});
test("My Day excludes completed reply tasks and does not mistake a waiting customer for work due", () => {
  const reply = { id: "r", company_name: "Customer", task_id: "closed", task_status: "done", status: "received", expires_at: "2026-10-31T00:00:00Z" };
  const items = buildMyDay(input({ replies: [reply, { ...reply, id: "waiting", task_id: null, status: "waiting" }, { ...reply, id: "uncertain", task_id: null, status: "uncertain" }] }), now);
  assert.equal(items.length, 1); assert.equal(items[0].id, "reply:uncertain");
  assert.match(items[0].reason, /Check Sent before sending again/);
});
