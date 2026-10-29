export const activityPageSize = 100;
export type ActivityTask = {
  id: string; title: string; notes: string | null; priority: string;
  due_at: string | null; company_id: string | null; updated_at: string;
  automation_id?: string | null;
  status?: string;
};
export type ActivityAlert = {
  id: string; message: string; channel: string; conversation_id: string | null;
  include_thread_link: boolean; read_at: string | null; created_at: string;
  task_id?: string | null;
};
export type FlowActivityData = {
  tasks: ActivityTask[]; alerts: ActivityAlert[];
  taskCount: number; alertCount: number; taskPage: number; alertPage: number;
  focusedTask?: ActivityTask | null;
};

export function activityPage(value: string | null) {
  const page = Number(value ?? 0);
  return Number.isSafeInteger(page) && page >= 0 && page <= 1_000_000 ? page : 0;
}

export function activityTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
