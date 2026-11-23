"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Gauge, RefreshCw } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatCredits, usagePercent, type CreditBalance } from "@/lib/billing/credits";

type Usage = { credits: CreditBalance; enabled: boolean };

export function AiUsageShortcut({ expanded = false }: { expanded?: boolean }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/ai/credits", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const data = await response.json() as Usage;
        if (!response.ok || !data.credits) throw new Error("Usage unavailable");
        if (!controller.signal.aborted) setResult(data);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, revision]);

  const credits = result?.credits;
  const used = credits ? usagePercent(credits.usedMicros, credits.includedMicros + credits.topupMicros) ?? 0 : 0;
  const reset = credits?.resetsAt && Number.isFinite(Date.parse(credits.resetsAt)) ? new Date(credits.resetsAt).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "short" }) : null;
  function changeOpen(next: boolean) {
    if (next) { setResult(null); setError(false); setLoading(true); }
    setOpen(next);
  }
  function refresh() {
    setLoading(true); setError(false); setRevision(value => value + 1);
  }

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger aria-label="AI usage" title="AI usage" className="workspace-sidebar-row">
      <Gauge aria-hidden="true" className="size-[18px] shrink-0" />
      {expanded ? <span>AI usage</span> : null}
    </PopoverTrigger>
    <PopoverContent side="right" align="end" sideOffset={12} className="w-80 max-w-[calc(100vw-24px)] gap-4 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3"><PopoverTitle>AI usage</PopoverTitle><button type="button" aria-label="Refresh usage" disabled={loading} onClick={refresh} className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-3.5${loading ? " animate-spin motion-reduce:animate-none" : ""}`} /></button></div>
      {loading && !result ? <p role="status" className="py-3 text-xs text-muted-foreground">Loading usage…</p> : error ? <div role="alert" className="space-y-2"><p className="text-xs text-muted-foreground">Unable to load AI usage. Please try again.</p><button type="button" onClick={refresh} className="rounded text-xs text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Retry loading usage</button></div> : credits ? <div aria-busy={loading} className="space-y-4">
        <div><p className="text-xs text-muted-foreground">Shared workspace balance</p><p className="mt-1 flex flex-wrap items-baseline gap-2"><strong className="text-3xl font-semibold tracking-tight tabular-nums" data-no-translate>{formatCredits(credits.remainingMicros)}</strong><span className="text-xs text-muted-foreground">available credits</span></p></div>
        <div role="progressbar" aria-label="AI credits available" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100 - used} className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${used >= 80 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${100 - used}%` }} /></div>
        <dl className="grid grid-cols-3 gap-2 text-xs"><div><dt className="min-h-8 text-muted-foreground">Credits used</dt><dd className="mt-1 font-medium tabular-nums" data-no-translate>{formatCredits(credits.usedMicros)}</dd></div><div><dt className="min-h-8 text-muted-foreground">Monthly allowance</dt><dd className="mt-1 font-medium tabular-nums" data-no-translate>{formatCredits(credits.includedMicros)}</dd></div><div><dt className="min-h-8 text-muted-foreground">Additional credits</dt><dd className="mt-1 font-medium tabular-nums" data-no-translate>{formatCredits(credits.topupMicros)}</dd></div></dl>
        {reset ? <p className="text-xs text-muted-foreground"><span>Monthly credits renew on</span> <time dateTime={credits.resetsAt} data-no-translate>{reset}</time></p> : null}
        {!result?.enabled ? <p role="status" className="text-xs text-destructive">AI is paused for your account. Contact an administrator to enable it.</p> : used >= 80 ? <p role="status" className="text-xs text-destructive">{credits.remainingMicros <= 0 ? "AI credits are used up. Ordinary CRM features remain available." : "Your AI credit balance is running low."}</p> : null}
      </div> : null}
      <Link href="/settings/credits" onClick={() => changeOpen(false)} className="flex items-center justify-between gap-2 rounded-sm border-t pt-3 text-xs text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">View plan credits and usage<ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>
    </PopoverContent>
  </Popover>;
}
