import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { isAutoReplySchemaMissing } from "../email-auto-reply.ts";
import { activityPageSize } from "../task-activity.ts";

export async function listFlowActivity(summary = false, pages: { taskPage: number; alertPage: number; taskId?: string } = { taskPage: 0, alertPage: 0 }) {
  const viewer = await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  if (summary) {
    const [tasks, alerts] = await Promise.all([
      admin.from("crm_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", viewer.id).eq("status", "open").throwOnError(),
      admin.from("internal_notifications").select("id", { count: "exact", head: true }).eq("user_id", viewer.id).is("read_at", null).throwOnError(),
    ]);
    return { openTasks: tasks.count ?? 0, unreadAlerts: alerts.count ?? 0 };
  }
  const [tasks, alerts] = await Promise.all([
    admin.from("crm_tasks").select("id,title,notes,priority,status,due_at,company_id,completed_at,updated_at", { count: "exact" }).eq("assigned_to", viewer.id).eq("status", "open").order("due_at", { ascending: true, nullsFirst: false }).order("id").range(pages.taskPage * activityPageSize, (pages.taskPage + 1) * activityPageSize - 1).throwOnError(),
    admin.from("internal_notifications").select("id,message,channel,conversation_id,include_thread_link,read_at,created_at,task_id", { count: "exact" }).eq("user_id", viewer.id).order("is_unread", { ascending: false }).order("created_at", { ascending: false }).order("id").range(pages.alertPage * activityPageSize, (pages.alertPage + 1) * activityPageSize - 1).throwOnError(),
  ]);
  const focused = pages.taskId ? await admin.from("crm_tasks").select("id,title,notes,priority,status,due_at,company_id,completed_at,updated_at").eq("id", pages.taskId).eq("assigned_to", viewer.id).maybeSingle().throwOnError() : { data: null };
  const taskIds = [...new Set([...(tasks.data ?? []).map(task => task.id), ...(focused.data ? [focused.data.id] : [])])];
  const automations = taskIds.length ? await admin.from("email_auto_replies").select("id,task_id")
    .eq("enabled", true).in("task_id", taskIds) : { data: [], error: null };
  if (automations.error && !isAutoReplySchemaMissing(automations.error)) throw automations.error;
  const byTask = new Map((automations.data ?? []).map((item) => [item.task_id, item.id]));
  return { tasks: (tasks.data ?? []).map((task) => ({ ...task, automation_id: byTask.get(task.id) ?? null })), alerts: alerts.data ?? [], focusedTask: focused.data ? { ...focused.data, automation_id: byTask.get(focused.data.id) ?? null } : null, taskCount: tasks.count ?? 0, alertCount: alerts.count ?? 0, taskPage: pages.taskPage, alertPage: pages.alertPage };
}

export async function updateFlowActivity(kind: "task" | "alert", id: string) {
  const viewer = await requireWorkspaceMember();
  if (kind === "task" && viewer.role === "viewer") throw new Error("Your workspace role is read-only.");
  const admin = createSupabaseAdmin();
  const now = new Date().toISOString();
  if (kind === "task") {
    const { data: task } = await admin.from("crm_tasks").select("id").eq("id", id).eq("assigned_to", viewer.id).eq("status", "open").maybeSingle().throwOnError();
    if (!task) throw new Error("This item is unavailable or belongs to another teammate.");
    const { data: automation, error } = await admin.from("email_auto_replies").select("id,enabled").eq("task_id", id).eq("enabled", true).maybeSingle();
    if (error && !isAutoReplySchemaMissing(error)) throw error;
    if (automation) throw new Error("Add the shipping cost or stop AI from this task before marking it complete.");
  }
  const { data } = kind === "task"
    ? await admin.from("crm_tasks").update({ status: "done", completed_at: now }).eq("id", id).eq("assigned_to", viewer.id).eq("status", "open").select("id").maybeSingle().throwOnError()
    : await admin.from("internal_notifications").update({ read_at: now }).eq("id", id).eq("user_id", viewer.id).select("id").maybeSingle().throwOnError();
  if (!data) throw new Error("This item is unavailable or belongs to another teammate.");
}
