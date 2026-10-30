export const activityPageSize = 100;
export type ActivityCompany = { id: string; name: string };
export type ActivityTask = {
  id: string; title: string; notes: string | null; priority: string;
  due_at: string | null; company_id: string | null; updated_at: string;
  completed_at?: string | null;
  automation_id?: string | null;
  status?: string;
  assigned_to?: string | null;
  created_by?: string | null;
  assigned_by?: string | null;
  assignee_name?: string | null;
  follows_company_owner?: boolean;
  company?: ActivityCompany | null;
  workflow?: import("./task-workflows").TaskWorkflowSummary | null;
};
export type ActivityAlert = {
  id: string; message: string; channel: string; conversation_id: string | null;
  include_thread_link: boolean; read_at: string | null; created_at: string;
  task_id?: string | null;
  workflow?: import("./task-workflows").TaskWorkflowSummary | null;
  company?: ActivityCompany | null;
};
export type FlowActivityData = {
  tasks: ActivityTask[]; alerts: ActivityAlert[];
  taskCount: number; alertCount: number; taskPage: number; alertPage: number;
  focusedTask?: ActivityTask | null;
  summary?: ActivitySummary;
  asOf?: string;
  taskView?: TaskView;
  alertView?: "all" | "unread";
  query?: string;
  viewerId?: string;
  taskScope?: "mine" | "delegated";
};

export type ActivitySummary = { openTasks: number; unreadAlerts: number; overdueTasks: number; dueToday: number };
export const taskViews = ["all", "today", "overdue", "upcoming", "completed"] as const;
export type TaskView = typeof taskViews[number];
export type ActivityListOptions = { taskPage: number; alertPage: number; taskId?: string; taskView?: TaskView; alertView?: "all" | "unread"; query?: string; preview?: boolean; taskScope?: "mine" | "delegated" };
export type TaskAssignee = { id: string; name: string; role: string };

export function activityDayBounds(now: Date) {
  const day = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+08:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

export function activitySearchPattern(query: string) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export function taskSource(task: ActivityTask) {
  if (task.automation_id) return "AI email review";
  if (task.notes?.startsWith("Company purchase analysis:")) return "Purchase follow-up";
  if (task.company_id) return "Company follow-up";
  return "Personal task";
}

export function taskNotes(task: ActivityTask) {
  if (task.notes === "Scheduled from intelligent next follow-up recommendation." || task.notes?.startsWith("Company purchase analysis:")) return "";
  return task.notes ?? "";
}

export function taskDueGroup(task: ActivityTask, now: Date) {
  if (task.status === "done") return "Completed";
  if (task.status === "cancelled") return "Cancelled";
  const due = task.due_at ? Date.parse(task.due_at) : NaN;
  if (!Number.isFinite(due)) return "No due date";
  if (due < now.getTime()) return "Overdue";
  if (due < Date.parse(activityDayBounds(now).end)) return "Today";
  return "Upcoming";
}

export function activityPage(value: string | null) {
  const page = Number(value ?? 0);
  return Number.isSafeInteger(page) && page >= 0 && page <= 1_000_000 ? page : 0;
}

export function activityTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
