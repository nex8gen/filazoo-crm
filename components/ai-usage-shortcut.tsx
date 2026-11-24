"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Gauge } from "lucide-react";
import { MICROS_PER_CREDIT, usagePercent, type CreditBalance } from "@/lib/billing/credits";

type Usage = { credits: CreditBalance; enabled: boolean };

export function AiUsageShortcut({ expanded = false }: { expanded?: boolean }) {
  const [result, setResult] = useState<Usage | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch("/api/ai/credits", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const data = await response.json() as Usage;
        if (!response.ok || !data.credits) throw new Error("Usage unavailable");
        if (!controller.signal.aborted) { setResult(data); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = false;
      }
    }
    function refreshVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    void refresh();
    const interval = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);

  const credits = result?.credits;
  const remaining = credits ? Math.max(0, credits.remainingMicros) / MICROS_PER_CREDIT : 0;
  const balance = remaining > 0 && remaining < 1 ? "<1" : Math.floor(remaining).toLocaleString("en-US");
  const used = credits ? usagePercent(credits.usedMicros, credits.includedMicros + credits.topupMicros) ?? 0 : 0;
  const warning = result?.enabled === false ? "AI paused" : credits && remaining <= 0 ? "AI credits are used up." : credits && used >= 80 ? "Low balance" : null;

  if (!expanded) return <Link href="/settings/credits" aria-label="AI usage" title="AI usage" className="workspace-sidebar-row"><Gauge aria-hidden="true" className="size-[18px] shrink-0" /></Link>;

  return <section aria-label="AI usage" className="workspace-ai-usage">
    <Link href="/settings/credits" aria-label="AI usage" className="workspace-ai-usage-link">
      <span className="flex items-center gap-2 text-xs font-medium"><Gauge aria-hidden="true" className="size-3.5" /><span>AI usage</span><ArrowUpRight aria-hidden="true" className="ml-auto size-3.5 opacity-60" /></span>
      {credits ? <>
        <span className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1"><strong className="text-xl font-semibold leading-none tracking-tight tabular-nums" data-no-translate>{balance}</strong><span className="workspace-ai-usage-caption text-[11px]">credits left</span></span>
        <span role="progressbar" aria-label="AI credits available" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100 - used} className="workspace-ai-usage-track mt-3 block h-1 overflow-hidden rounded-full">
          <span className={`block h-full rounded-full transition-[width] motion-reduce:transition-none ${used >= 80 ? "bg-[#a12d2d]" : "bg-current"}`} style={{ width: `${100 - used}%` }} />
        </span>
        {warning ? <span role="status" className="mt-2 block text-[11px] font-medium text-[#922626]">{warning}</span> : null}
      </> : error ? <span role="status" className="workspace-ai-usage-caption mt-3 block text-xs">Unable to load usage</span> : <span role="status" className="mt-3 block" aria-label="Loading usage">
        <span aria-hidden="true" className="block h-5 w-24 animate-pulse rounded bg-current/10 motion-reduce:animate-none" />
        <span aria-hidden="true" className="mt-3 block h-1 rounded-full bg-current/10" />
      </span>}
    </Link>
  </section>;
}
