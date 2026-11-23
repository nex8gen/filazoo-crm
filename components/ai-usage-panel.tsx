"use client";

import type { AiBudgetSummary, BudgetMeter } from "@/lib/ai/budget";
import { formatCredits } from "@/lib/billing/credits";

function Meter({ label, value }: { label: string; value: BudgetMeter }) {
  const percent = Math.max(0, Math.min(100, value.percent));
  return <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-3 text-xs"><span>{label}</span><strong data-no-translate>{percent}%</strong></div>
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full transition-[width] ${percent >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${percent}%` }} />
    </div>
    <p className="text-xs text-muted-foreground" data-no-translate>${(value.usedMicros / 1e6).toFixed(3)} / ${(value.limitMicros / 1e6).toFixed(3)} USD</p>
  </div>;
}

export function AiUsagePanel({ limits }: { limits: AiBudgetSummary }) {
  return <section aria-label="AI allowance" className="space-y-3 rounded-lg border p-3">
    {limits.credits ? <div className="space-y-2"><p className="text-sm font-semibold">{formatCredits(limits.credits.remainingMicros)} AI credits remaining</p><p className="text-xs text-muted-foreground">Chats, agents and background AI share these credits. Larger tasks use more credits. No automatic top-ups.</p>{limits.credits.percent >= 80 ? <p role="status" className="text-xs text-destructive">{limits.credits.remainingMicros === 0 ? "AI credits are used up. Ordinary CRM features remain available." : "AI credits are running low."}</p> : null}</div> : null}
    {limits.creditOnly ? <p className="text-xs text-muted-foreground">AI usage follows your plan credit balance. Legacy dollar caps and daily member allowances do not apply.</p> : <details><summary className="cursor-pointer text-xs text-muted-foreground">Additional spending controls</summary><div className="mt-3 space-y-3">
    {limits.enabled === false ? <p role="status" className="text-xs text-destructive">AI is paused for your account. Contact an administrator to enable it.</p> : null}
    <Meter label="Your daily AI usage" value={limits.daily} />
    <Meter label="Workspace daily AI usage" value={limits.workspaceDaily} />
    <Meter label="Workspace monthly AI usage" value={limits.monthly} />
    <p className="text-xs leading-4 text-muted-foreground">Daily allowance resets at midnight China time. Monthly allowance resets on the first day of the month. Chats, agents and background AI share these limits.</p>
    <p className="text-xs leading-4 text-muted-foreground">Usage includes reserved credit for running requests. Large tasks may need more remaining credit.</p>
    {limits.enabled !== false ? <>
      {limits.daily.limitMicros === 0 || limits.workspaceDaily.limitMicros === 0 || limits.monthly.limitMicros === 0 ? <p role="status" className="text-xs text-destructive">AI spending is paused by a zero allowance. Ask an administrator to review the usage limits.</p>
        : limits.monthly.remainingMicros === 0 ? <p role="status" className="text-xs text-destructive">Workspace monthly AI allowance reached. It resets on the first day of next month.</p>
        : limits.daily.remainingMicros === 0 ? <p role="status" className="text-xs text-destructive">Your daily AI allowance reached. It resets at midnight China time.</p>
        : limits.workspaceDaily.remainingMicros === 0 ? <p role="status" className="text-xs text-destructive">Workspace daily AI allowance reached. It resets at midnight China time.</p> : null}
    </> : null}
    </div></details>}
  </section>;
}
