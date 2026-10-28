"use client";

import { useEffect, useRef } from "react";

// Activity restarts effects when a cached route becomes visible again. Keep
// freshness in a ref so returning to a page doesn't restart expensive polling.
export function useBackgroundRefresh(refresh: () => Promise<void>, enabled: boolean, intervalSeconds: number) {
  const lastRefreshAt = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const minimumInterval = (intervalSeconds || 15) * 1000;
    const refreshIfDue = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (lastRefreshAt.current !== null && now - lastRefreshAt.current < minimumInterval) return;
      lastRefreshAt.current = now;
      // Callers handle request errors and render their own non-blocking notice.
      void refresh();
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
