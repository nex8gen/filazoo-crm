import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { isAutoReplySchemaMissing } from "../email-auto-reply.ts";

export async function listFlowActivity(summary = false) {
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
    admin.from("crm_tasks").select("id,title,notes,priority,status,due_at,company_id,completed_at").eq("assigned_to", viewer.id).eq("status", "open").order("due_at").limit(100).throwOnError(),
    admin.from("internal_notifications").select("id,message,channel,conversation_id,include_thread_link,read_at,created_at").eq("user_id", viewer.id).order("created_at", { ascending: false }).limit(100).throwOnError(),
  ]);
  const automations = tasks.data?.length ? await admin.from("email_auto_replies").select("id,task_id")
    .eq("enabled", true).in("task_id", tasks.data.map((task) => task.id)) : { data: [], error: null };
  if (automations.error && !isAutoReplySchemaMissing(automations.error)) throw automations.error;
  const byTask = new Map((automations.data ?? []).map((item) => [item.task_id, item.id]));
  return { tasks: (tasks.data ?? []).map((task) => ({ ...task, automation_id: byTask.get(task.id) ?? null })), alerts: alerts.data ?? [] };
}

export async function updateFlowActivity(kind: "task" | "alert", id: string) {
  const viewer = await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  const now = new Date().toISOString();
  if (kind === "task") {
    const { data: automation, error } = await admin.from("email_auto_replies").select("id,enabled").eq("task_id", id).eq("enabled", true).maybeSingle();
    if (error && !isAutoReplySchemaMissing(error)) throw error;
    if (automation) throw new Error("Add the shipping cost or stop AI from this task before marking it complete.");
  }
  const { data } = kind === "task"
    ? await admin.from("crm_tasks").update({ status: "done", completed_at: now }).eq("id", id).eq("assigned_to", viewer.id).select("id").maybeSingle().throwOnError()
    : await admin.from("internal_notifications").update({ read_at: now }).eq("id", id).eq("user_id", viewer.id).select("id").maybeSingle().throwOnError();
  if (!data) throw new Error("This item is unavailable or belongs to another teammate.");
}
