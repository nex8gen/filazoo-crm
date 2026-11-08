"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { normalizeHomeMetrics, type HomeMetricId } from "@/lib/home-metrics";

const changed = "filazoo:home-metrics-changed";
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changed, listener); };
};

export function useHomeMetrics(preferenceKey: string) {
  const key = `filazoo:home-metrics:v1:${preferenceKey}`;
  const [fallback, setFallback] = useState<string | null>(null);
  const read = useCallback(() => { try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; } }, [key]);
  const stored = useSyncExternalStore(subscribe, read, () => "");
  let parsed: { metrics?: unknown; currency?: unknown } = {};
  try { const value: unknown = JSON.parse(fallback ?? stored); if (value && typeof value === "object") parsed = value; } catch { /* Use defaults for older or invalid preferences. */ }
  const metrics = normalizeHomeMetrics(parsed.metrics);
  const currency = typeof parsed.currency === "string" && /^[A-Z]{3}$/.test(parsed.currency) ? parsed.currency : null;
  const save = (next: { metrics: HomeMetricId[]; currency: string }) => {
    const serialized = JSON.stringify(next);
    try { window.localStorage.setItem(key, serialized); window.dispatchEvent(new Event(changed)); setFallback(null); }
    catch { setFallback(serialized); }
  };
  return { metrics, currency, save };
}
