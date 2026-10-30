"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const refreshAfterMs = 5 * 60 * 1000;

/** Show the router's saved page first, then update older snapshots quietly. */
export function useVisitedPageRefresh(pathname: string, enabled: boolean) {
  const router = useRouter();
  const search = useSearchParams().toString();
  const refreshedAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;
    const key = `${pathname}?${search}`;
    const pages = refreshedAt.current;
    if (!pages.has(key)) pages.set(key, Date.now());
    if (pages.size > 100) pages.delete(pages.keys().next().value!);
    const refreshIfDue = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - (pages.get(key) ?? now) < refreshAfterMs) return;
      pages.set(key, now);
      startTransition(() => router.refresh());
    };
    const initialTimer = window.setTimeout(refreshIfDue, 0);
    const timer = window.setInterval(refreshIfDue, refreshAfterMs);
    window.addEventListener("focus", refreshIfDue);
    document.addEventListener("visibilitychange", refreshIfDue);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfDue);
      document.removeEventListener("visibilitychange", refreshIfDue);
    };
  }, [pathname, search, enabled, router]);
}
