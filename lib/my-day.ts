import { activityDayBounds } from "./task-activity.ts";

export const myDayKinds = ["task", "reply", "followup", "payment"] as const;
export type MyDayKind = typeof myDayKinds[number];
export type MyDayItem = {
  id: string; kind: MyDayKind; title: string; company: string | null;
  reason: string; href: string; action: string; dueAt: string | null;
  urgency: "overdue" | "today" | "attention" | "upcoming";
  amount?: { minor: number; currency: string };
};
export type MyDaySource = { id: string; label: string; ok: boolean };
export type MyDayData = { items: MyDayItem[]; sources: MyDaySource[]; asOf: string };
export type MyDayTask = { id: string; title: string; company_id: string | null; company_name: string | null; priority: string; due_at: string | null; status: string; notes?: string | null };
export type MyDayFollowup = { company_id: string; company_name: string; due_at: string };
export type MyDayInvoice = { id: string; number: number; company_name: string; due_date: string; currency: string; total_minor: number; paid_minor: number; status: string };
export type MyDayReply = { id: string; company_name: string; task_id: string | null; task_status: string | null; status: string; expires_at: string };
export type MyDayInputs = { tasks: MyDayTask[]; followups: MyDayFollowup[]; invoices: MyDayInvoice[]; replies: MyDayReply[] };

export function buildMyDay(input: MyDayInputs, now = new Date()): MyDayItem[] {
  const time = now.getTime();
  const day = activityDayBounds(now);
  const today = new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
  const end = Date.parse(day.end);
  const urgency = (due: string | null): MyDayItem["urgency"] => {
    const when = Date.parse(due ?? "");
    return !Number.isFinite(when) ? "attention" : when < time ? "overdue" : when < end ? "today" : "upcoming";
  };
  const items: Array<MyDayItem & { priority: number }> = [];
  const followupCompanies = new Set<string>();
  const replyTasks = new Map(input.replies.filter(reply => reply.task_id && reply.task_status === "open" && ["received", "expired"].includes(reply.status)).map(reply => [reply.task_id, reply]));
  for (const task of input.tasks) {
    if (task.status !== "open") continue;
    const followup = task.notes === "Scheduled from intelligent next follow-up recommendation.";
    if (followup && task.company_id) followupCompanies.add(task.company_id);
    const reply = replyTasks.get(task.id);
    const kind = reply ? "reply" : followup ? "followup" : "task";
    const due = urgency(task.due_at);
    items.push({ id: `task:${task.id}`, kind, title: task.title, company: task.company_name,
      reason: reply ? reply.status === "received" ? "A customer reply is ready for your review." : "The customer reply deadline passed. Review before following up."
        : due === "overdue" ? "This work is past its scheduled time." : due === "today" ? "Scheduled for today." : due === "upcoming" ? "Scheduled for a later day." : "Open work without a due date.",
      href: `/tasks?task=${encodeURIComponent(task.id)}`, action: "Review task", dueAt: task.due_at, urgency: reply && due === "attention" ? "attention" : due,
      priority: reply ? 3 : task.priority === "high" ? 2 : task.priority === "low" ? 0 : 1 });
  }
  for (const followup of input.followups) {
    // The existing database trigger normally creates a task for this reminder.
    if (followupCompanies.has(followup.company_id) || !Number.isFinite(Date.parse(followup.due_at))) continue;
    const due = urgency(followup.due_at);
    items.push({ id: `followup:${followup.company_id}`, kind: "followup", title: "Follow up with customer", company: followup.company_name,
      reason: due === "overdue" ? "The saved customer follow-up is overdue." : due === "today" ? "This customer is due for follow-up today." : "A customer follow-up is scheduled.",
      href: `/companies/${encodeURIComponent(followup.company_id)}`, action: "Open customer", dueAt: followup.due_at, urgency: due, priority: 1 });
  }
  for (const invoice of new Map(input.invoices.map(row => [row.id, row])).values()) {
    const outstanding = Number(invoice.total_minor) - Number(invoice.paid_minor);
    if (invoice.status !== "issued" || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.due_date) || invoice.due_date > today || !Number.isSafeInteger(outstanding) || outstanding <= 0) continue;
    const overdue = invoice.due_date < today;
    items.push({ id: `payment:${invoice.id}`, kind: "payment", title: `Invoice #${invoice.number}`, company: invoice.company_name,
      reason: overdue ? "An issued invoice has an overdue balance." : "An issued invoice has a balance due today.",
      href: `/invoices/${encodeURIComponent(invoice.id)}`, action: "Review invoice", dueAt: `${invoice.due_date}T23:59:59+08:00`, urgency: overdue ? "overdue" : "today",
      amount: { minor: outstanding, currency: invoice.currency }, priority: 1 });
  }
  for (const reply of input.replies) {
    // Reply tasks use the same review route and must not appear twice.
    if (reply.task_id || !["blocked", "uncertain"].includes(reply.status)) continue;
    items.push({ id: `reply:${reply.id}`, kind: "reply", title: "Check customer reply workflow", company: reply.company_name,
      reason: reply.status === "uncertain" ? "Delivery was not confirmed. Check Sent before sending again." : "A customer reply workflow needs your attention.",
      href: "/tasks?view=replies", action: "Open customer replies", dueAt: null, urgency: "attention", priority: 3 });
  }
  const rank = { overdue: 0, today: 1, attention: 2, upcoming: 3 };
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency] || b.priority - a.priority
    || (Date.parse(a.dueAt ?? "") || Infinity) - (Date.parse(b.dueAt ?? "") || Infinity) || a.id.localeCompare(b.id))
    .map(({ priority: _priority, ...item }) => { void _priority; return item; });
}
