"use client";

import { useEffect, useRef } from "react";

// Activity restarts effects when a cached route becomes visible again. Keep
// freshness in a ref so returning to a page doesn't restart expensive polling.
export function useBackgroundRefresh(refresh: () => Promise<void>, enabled: boolean, intervalSeconds: number) {
  const lastRefreshAt = useRef<number | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const minimumInterval = (intervalSeconds || 15) * 1000;
    const refreshIfDue = () => {
      if (document.visibilityState !== "visible" || pending.current) return;
      const now = Date.now();
      if (lastRefreshAt.current !== null && now - lastRefreshAt.current < minimumInterval) return;
      lastRefreshAt.current = now;
      pending.current = true;
      // Callers handle request errors and render their own non-blocking notice.
      void (async () => {
        try { await refresh(); }
        catch { /* A later poll retries without an unhandled rejection. */ }
        finally { pending.current = false; }
      })();
    };
    const initialTimer = window.setTimeout(refreshIfDue, 0);
    const timer = intervalSeconds ? window.setInterval(refreshIfDue, minimumInterval) : undefined;
    window.addEventListener("focus", refreshIfDue);
    document.addEventListener("visibilitychange", refreshIfDue);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfDue);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, [enabled, refresh, intervalSeconds]);
}
