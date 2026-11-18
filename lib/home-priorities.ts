import type { ActivityTask } from "./task-activity.ts";
import { activityDayBounds } from "./task-activity.ts";

export const priorityGroups = [
  { id: "urgent_important", label: "Urgent & important", description: "Handle first", tone: "rose" },
  { id: "urgent", label: "Urgent, less important", description: "Handle quickly or delegate", tone: "amber" },
  { id: "important", label: "Important, not urgent", description: "Schedule time to make progress", tone: "green" },
  { id: "later", label: "Other tasks", description: "Review when you have time", tone: "slate" },
] as const;
export type PriorityGroup = typeof priorityGroups[number]["id"];

export function homePriorityGroup(task: ActivityTask, asOf: string): PriorityGroup {
  const due = Date.parse(task.due_at || "");
  const urgent = Number.isFinite(due) && due < Date.parse(activityDayBounds(new Date(asOf)).end);
  const important = task.priority === "high";
  return urgent ? important ? "urgent_important" : "urgent" : important ? "important" : "later";
}

export function groupHomePriorities(tasks: ActivityTask[], asOf: string) {
  const groups: Record<PriorityGroup, ActivityTask[]> = { urgent_important: [], urgent: [], important: [], later: [] };
  for (const task of tasks) if (!task.status || task.status === "open") groups[homePriorityGroup(task, asOf)].push(task);
  for (const items of Object.values(groups)) items.sort((a, b) => (Date.parse(a.due_at || "") || Infinity) - (Date.parse(b.due_at || "") || Infinity) || a.title.localeCompare(b.title));
  return groups;
}
