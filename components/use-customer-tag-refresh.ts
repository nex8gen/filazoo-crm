"use client";

import { startTransition, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useBackgroundRefresh } from "./use-background-refresh";

/** One workspace probe keeps server-rendered company/segment tags fresh across users. */
export function useCustomerTagRefresh(enabled: boolean) {
  const router = useRouter();
  const revision = useRef<string | null>(null);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      const response = await fetch("/api/customer-tags/revision", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const result = await response.json();
      if (typeof result.revision !== "string") return;
      const previous = revision.current;
      revision.current = result.revision;
      if (previous !== null && previous !== result.revision) startTransition(() => router.refresh());
    } catch { /* Retain the current display during a temporary outage. */ }
    finally { pending.current = false; }
  }, [router]);
  useBackgroundRefresh(refresh, enabled, 30);
}
