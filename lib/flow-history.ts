export type FlowHistoryChange = { kind: string; description: string };
export type FlowHistoryEntry = {
  id: string;
  version: number;
  actor_label: string;
  created_at: string;
  changes: FlowHistoryChange[];
};

export const flowHistoryFilters = ["all", "created", "name", "status", "trigger", "actions"] as const;
export type FlowHistoryFilter = typeof flowHistoryFilters[number];
