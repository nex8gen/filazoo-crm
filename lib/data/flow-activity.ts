import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

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
  return { tasks: tasks.data ?? [], alerts: alerts.data ?? [] };
}

export async function updateFlowActivity(kind: "task" | "alert", id: string) {
  const viewer = await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  const now = new Date().toISOString();
  const { data } = kind === "task"
    ? await admin.from("crm_tasks").update({ status: "done", completed_at: now }).eq("id", id).eq("assigned_to", viewer.id).select("id").maybeSingle().throwOnError()
    : await admin.from("internal_notifications").update({ read_at: now }).eq("id", id).eq("user_id", viewer.id).select("id").maybeSingle().throwOnError();
  if (!data) throw new Error("This item is unavailable or belongs to another teammate.");
}
