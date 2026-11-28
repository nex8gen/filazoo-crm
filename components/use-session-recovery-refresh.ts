"use client";

import { startTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Preserve visited routes until a save, explicit refresh, or network recovery. */
export function useSessionRecoveryRefresh(enabled: boolean) {
  const router = useRouter();
  const disconnected = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const recover = () => {
      if (!disconnected.current || !navigator.onLine || document.visibilityState !== "visible") return;
      disconnected.current = false;
      startTransition(() => router.refresh());
    };
    const offline = () => { disconnected.current = true; };
    if (!navigator.onLine) offline();
    recover();
    window.addEventListener("offline", offline);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [enabled, router]);
}
