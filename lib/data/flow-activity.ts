import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { isAutoReplySchemaMissing } from "../email-auto-reply.ts";
import { activityPageSize, activityDayBounds, activitySearchPattern, type ActivityListOptions, type ActivityCompany, type ActivityTask, type ActivityAlert } from "../task-activity.ts";

type Relation<T> = T | T[] | null;
type TaskRow = Omit<ActivityTask, "company"> & { company: Relation<ActivityCompany> };
type AlertRow = ActivityAlert & { task: Relation<{ company: Relation<ActivityCompany> }>; run: Relation<{ company: Relation<ActivityCompany> }> };
const first = <T,>(value: Relation<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

export async function listFlowActivity(summary = false, pages: ActivityListOptions = { taskPage: 0, alertPage: 0 }) {
  const viewer = await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  const now = new Date();
  const day = activityDayBounds(now);
  const countsPromise = Promise.all([
      admin.from("crm_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", viewer.id).eq("status", "open").throwOnError(),
      admin.from("internal_notifications").select("id", { count: "exact", head: true }).eq("user_id", viewer.id).is("read_at", null).throwOnError(),
      admin.from("crm_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", viewer.id).eq("status", "open").lt("due_at", now.toISOString()).throwOnError(),
      admin.from("crm_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", viewer.id).eq("status", "open").gte("due_at", day.start).lt("due_at", day.end).throwOnError(),
  ]).then(([tasks, alerts, overdue, today]) => ({ openTasks: tasks.count ?? 0, unreadAlerts: alerts.count ?? 0, overdueTasks: overdue.count ?? 0, dueToday: today.count ?? 0 }));
  if (summary) return countsPromise;
  const taskView = pages.taskView ?? "all", alertView = pages.alertView ?? "all", query = pages.query?.trim().slice(0, 120) ?? "";
  const pageSize = pages.preview ? 5 : activityPageSize;
  const taskScope = pages.taskScope ?? "mine";
  const fields = "id,title,notes,priority,status,due_at,company_id,completed_at,updated_at,assigned_to,created_by,assigned_by,follows_company_owner,company:companies(id,name)";
  let taskQuery = admin.from("crm_tasks").select(fields, { count: "exact" }).eq("status", taskView === "completed" ? "done" : "open");
  taskQuery = taskScope === "delegated" ? taskQuery.or(`created_by.eq.${viewer.id},assigned_by.eq.${viewer.id}`) : taskQuery.eq("assigned_to", viewer.id);
  if (taskView === "overdue") taskQuery = taskQuery.lt("due_at", now.toISOString());
  if (taskView === "today") taskQuery = taskQuery.gte("due_at", day.start).lt("due_at", day.end);
  if (taskView === "upcoming") taskQuery = taskQuery.gte("due_at", day.end);
  if (query) taskQuery = taskQuery.ilike("title", activitySearchPattern(query));
  taskQuery = taskView === "completed" ? taskQuery.order("completed_at", { ascending: false, nullsFirst: false }) : taskQuery.order("due_at", { ascending: true, nullsFirst: false });
  let alertQuery = admin.from("internal_notifications").select("id,message,channel,conversation_id,include_thread_link,read_at,created_at,task_id,task:crm_tasks(company:companies(id,name)),run:flow_runs(company:companies(id,name))", { count: "exact" }).eq("user_id", viewer.id);
  if (alertView === "unread") alertQuery = alertQuery.is("read_at", null);
  if (query) alertQuery = alertQuery.ilike("message", activitySearchPattern(query));
  const [tasks, alerts, counts] = await Promise.all([
    taskQuery.order("id").range(pages.taskPage * pageSize, (pages.taskPage + 1) * pageSize - 1).throwOnError(),
    alertQuery.order("is_unread", { ascending: false }).order("created_at", { ascending: false }).order("id").range(pages.alertPage * pageSize, (pages.alertPage + 1) * pageSize - 1).throwOnError(),
    countsPromise,
  ]);
  const focusedResult = pages.taskId ? await admin.from("crm_tasks").select(fields).eq("id", pages.taskId).maybeSingle().throwOnError() : { data: null };
  const focused = { data: focusedResult.data && [focusedResult.data.assigned_to, focusedResult.data.created_by, focusedResult.data.assigned_by].includes(viewer.id) ? focusedResult.data : null };
  const taskIds = [...new Set([...(tasks.data ?? []).map(task => task.id), ...(alerts.data ?? []).flatMap(alert => alert.task_id ? [alert.task_id] : []), ...(focused.data ? [focused.data.id] : [])])];
  const workResult = taskIds.length ? await admin.from("crm_task_workflows").select("task_id,kind,status,invoice_id,revision").in("task_id", taskIds).throwOnError() : { data: [] };
  const workByTask = new Map((workResult.data ?? []).map(work => [work.task_id, work]));
  const automations = taskIds.length ? await admin.from("email_auto_replies").select("id,task_id")
    .eq("enabled", true).in("task_id", taskIds) : { data: [], error: null };
  if (automations.error && !isAutoReplySchemaMissing(automations.error)) throw automations.error;
  const byTask = new Map((automations.data ?? []).map((item) => [item.task_id, item.id]));
  const userIds = [...new Set([...(tasks.data ?? []), ...(focused.data ? [focused.data] : [])].map(task => task.assigned_to).filter((id): id is string => Boolean(id)))];
  const members = userIds.length ? await admin.from("workspace_members").select("user_id,display_name").in("user_id", userIds) : { data: [], error: null };
  const names = new Map((members.data ?? []).map(member => [member.user_id, member.display_name]));
  const alertRows = (alerts.data ?? []) as unknown as AlertRow[];
  const conversationCompanyId = (value: string | null) => /^company:([\da-f-]{36})(?::pipeline|:lead:[\da-f-]{36})?$/i.exec(value ?? "")?.[1];
  const companyIds = [...new Set(alertRows.map(alert => conversationCompanyId(alert.conversation_id)).filter((id): id is string => Boolean(id)))];
  const companies = companyIds.length ? await admin.from("companies").select("id,name").in("id", companyIds).throwOnError() : { data: [] };
  const companyNames = new Map((companies.data ?? []).map(company => [company.id, company as ActivityCompany]));
  const present = (task: TaskRow): ActivityTask => ({ ...task, company: first(task.company), workflow: workByTask.get(task.id) ?? null, automation_id: byTask.get(task.id) ?? null, assignee_name: task.assigned_to ? names.get(task.assigned_to) ?? null : null });
  const presentAlert = ({ task, run, ...alert }: AlertRow): ActivityAlert => ({ ...alert, workflow: alert.task_id ? workByTask.get(alert.task_id) ?? null : null, company: first(first(task)?.company ?? null) ?? first(first(run)?.company ?? null) ?? companyNames.get(conversationCompanyId(alert.conversation_id) ?? "") ?? null });
  return { tasks: ((tasks.data ?? []) as unknown as TaskRow[]).map(present), alerts: alertRows.map(presentAlert), focusedTask: focused.data ? present(focused.data as unknown as TaskRow) : null, taskCount: tasks.count ?? 0, alertCount: alerts.count ?? 0, taskPage: pages.taskPage, alertPage: pages.alertPage, summary: counts, asOf: now.toISOString(), taskView, alertView, query, taskScope, viewerId: viewer.id };
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
