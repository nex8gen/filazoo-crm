import { z } from "zod";

export const leadAssignmentSettingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  strategy: z.enum(["lowest_workload", "round_robin"]),
  workload: z.enum(["all", "open"]),
  members: z.array(z.object({
    userId: z.uuid(),
    enabled: z.boolean(),
    capacity: z.number().int().min(1).max(1000000).nullable(),
  }).strict()).max(1000),
}).strict().refine(value => new Set(value.members.map(member => member.userId)).size === value.members.length, "Choose each manager only once.");

export type LeadAssignmentSettings = z.infer<typeof leadAssignmentSettingsSchema>;
export type LeadAssignmentView = Omit<LeadAssignmentSettings, "members"> & {
  unassigned: number;
  members: Array<LeadAssignmentSettings["members"][number] & {
    name: string; activated: boolean; total: number; open: number; lastAssignedAt: string | null;
  }>;
};

export function assignmentCapacity(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/** Read-only preview. Saving or previewing a rule must never consume a turn. */
export function nextAssignment(view: LeadAssignmentView): LeadAssignmentView["members"][number] | null {
  if (!view.enabled) return null;
  return view.members.filter(member => member.activated && member.enabled &&
    (member.capacity === null || member[view.workload === "open" ? "open" : "total"] < member.capacity))
    .sort((a, b) => (view.strategy === "lowest_workload" ? a[view.workload === "open" ? "open" : "total"] - b[view.workload === "open" ? "open" : "total"] : 0) ||
      (a.lastAssignedAt || "").localeCompare(b.lastAssignedAt || "") || a.userId.localeCompare(b.userId))[0] ?? null;
}
