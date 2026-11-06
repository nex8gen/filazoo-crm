"use client";

import type { AiBudgetSummary, BudgetMeter } from "@/lib/ai/budget";

function Meter({ label, value }: { label: string; value: BudgetMeter }) {
  const percent = Math.max(0, Math.min(100, value.percent));
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-3 text-xs"><span>{label}</span><strong data-no-translate>{percent}%</strong></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full transition-[width] ${percent >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} />
    </div>
    <p className="text-[10px] text-muted-foreground" data-no-translate>${(value.usedMicros / 1e6).toFixed(3)} / ${(value.limitMicros / 1e6).toFixed(3)} USD</p>
  </div>;
}

export function AiUsagePanel({ limits }: { limits: AiBudgetSummary }) {
  return <section aria-label="AI allowance" className="space-y-3 rounded-lg border p-3">
    {limits.enabled === false ? <p role="status" className="text-xs text-destructive">AI is paused for your account. Contact an administrator to enable it.</p> : null}
    <Meter label="Your daily AI usage" value={limits.daily} />
    <Meter label="Workspace daily AI usage" value={limits.workspaceDaily} />
    <Meter label="Workspace monthly AI usage" value={limits.monthly} />
    <p className="text-[10px] leading-4 text-muted-foreground">Daily allowance resets at midnight China time. Monthly allowance resets on the first day of the month. Chats, agents and background AI share these limits.</p>
    <p className="text-[10px] leading-4 text-muted-foreground">Usage includes reserved credit for running requests. Large tasks may need more remaining credit.</p>
    {limits.enabled !== false ? <>
      {limits.daily.limitMicros === 0 || limits.workspaceDaily.limitMicros === 0 || limits.monthly.limitMicros === 0 ? <p role="status" className="text-xs text-destructive">AI spending is paused by a zero allowance. Ask an administrator to review the usage limits.</p>
        : limits.monthly.remainingMicros === 0 ? <p role="status" className="text-xs text-destructive">Workspace monthly AI allowance reached. It resets on the first day of next month.</p>
        : limits.daily.remainingMicros === 0 ? <p role="status" className="text-xs text-destructive">Your daily AI allowance reached. It resets at midnight China time.</p>
        : limits.workspaceDaily.remainingMicros === 0 ? <p role="status" className="text-xs text-destructive">Workspace daily AI allowance reached. It resets at midnight China time.</p> : null}
    </> : null}
  </section>;
}
