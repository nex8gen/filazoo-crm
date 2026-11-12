"use client";

import { Bot, CheckCircle2, Hand, Layers, LoaderCircle, Sparkles } from "lucide-react";
import type { FollowupFilter } from "@/lib/email-followup-filters";

const filters = [
  { id: "all", label: "All", icon: Layers, active: "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" },
  { id: "ai", label: "AI following up", icon: Bot, active: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300" },
  { id: "manual", label: "Waiting for manual follow-up", icon: Hand, active: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300" },
  { id: "completed", label: "Completed", icon: CheckCircle2, active: "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" },
  { id: "nurture", label: "Dormant AI nurture", icon: Sparkles, active: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300" },
] as const;

export function EmailFollowupFilters({ value, onChange, counts, loading }: {
  value: FollowupFilter | null; onChange: (value: FollowupFilter) => void;
  counts: Record<FollowupFilter, number>; loading: boolean;
}) {
  return <div className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b bg-background px-4 py-2" role="group" aria-label="Filter by follow-up action" aria-busy={loading}>
    {filters.map(filter => <button key={filter.id} type="button" aria-pressed={value === filter.id} onClick={() => onChange(filter.id)} className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${value === filter.id ? filter.active : "border-border bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
      <filter.icon aria-hidden="true" className={`size-3.5 ${filter.id === "ai" ? "text-blue-500" : filter.id === "manual" ? "text-orange-500" : filter.id === "nurture" ? "text-violet-500" : ""}`} />
      <span>{filter.label}</span><span className="text-[10px] tabular-nums opacity-70">{counts[filter.id]}</span>
      {filter.id === "nurture" && counts.nurture > 0 ? <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" /> : null}
    </button>)}
    {loading ? <LoaderCircle aria-label="Loading follow-up filters" className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
  </div>;
}
