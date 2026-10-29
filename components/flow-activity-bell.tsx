"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

export function FlowActivityBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    let queued = false;
    let lastRefreshAt: number | null = null;
    const refresh = async (force = false) => {
      if (document.visibilityState === "hidden" || controller.signal.aborted) return;
      if (busy) { if (force) queued = true; return; }
      if (!force && lastRefreshAt !== null && Date.now() - lastRefreshAt < 60_000) return;
      busy = true;
      lastRefreshAt = Date.now();
      try {
        const response = await fetch("/api/flows/activity?summary=1", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted && result.ok) setCount(result.openTasks + result.unreadAlerts);
      } catch { /* The activity page displays retrieval errors. */ }
      finally { busy = false; if (queued) { queued = false; void refresh(true); } }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh(true);
    const onUpdated = () => void refresh(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("flow-activity-updated", onUpdated);
    window.addEventListener("filazoo:agent-action", onUpdated);
    document.addEventListener("visibilitychange", onFocus);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("focus", onFocus); window.removeEventListener("flow-activity-updated", onUpdated); window.removeEventListener("filazoo:agent-action", onUpdated); document.removeEventListener("visibilitychange", onFocus); };
  }, []);
  return <Link href="/tasks" aria-label={`Tasks and notifications${count ? ` (${count} pending)` : ""}`} className="relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><Bell className="size-4" />{count > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{count > 99 ? "99+" : count}</span> : null}</Link>;
}

