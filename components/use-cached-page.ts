"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPageCache } from "@/lib/page-cache";

export function useCachedPage<T>(initialKey: string, initialValue: T, read: (key: string, signal: AbortSignal) => Promise<T>, sharedCache?: ReturnType<typeof createPageCache<T>>) {
  const [cache] = useState(() => sharedCache ?? createPageCache(initialKey, initialValue));
  const [active, setActive] = useState(() => ({ key: initialKey, value: cache.get(initialKey) ?? initialValue }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(initialKey);
  const sequence = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const select = useCallback(async (key: string, refresh = false) => {
    const ticket = ++sequence.current;
    setRequested(key);
    if (refresh) cache.clear();
    setError(null);
    if (cache.has(key)) {
      setActive({ key, value: cache.get(key)! }); setLoading(false); return true;
    }
    setLoading(true);
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const value = await cache.load(key, () => read(key, controller.signal));
      if (ticket !== sequence.current) return false;
      setActive({ key, value }); return true;
    } catch (cause) {
      if (ticket === sequence.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load this page. Please retry.");
      else if (ticket === sequence.current) setError("The request timed out. Please retry.");
      return false;
    } finally {
      clearTimeout(timeout); controllers.current.delete(controller);
      if (ticket === sequence.current) setLoading(false);
    }
  }, [cache, read]);
  useEffect(() => {
    const pending = controllers.current;
    const counter = sequence;
    return () => { counter.current++; for (const controller of pending) controller.abort(); };
  }, []);
  const remember = useCallback((key: string, value: T) => cache.set(key, value), [cache]);
  return { ...active, requestedKey: requested, loading, error, select, remember, retry: () => select(requested), invalidate: cache.clear };
}
