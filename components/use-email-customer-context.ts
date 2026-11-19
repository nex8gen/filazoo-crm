"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EmailCustomerContext, EmailCustomerEntry } from "@/lib/email-customer-context";
import { useBackgroundRefresh } from "./use-background-refresh";

export function useEmailCustomerContext(mailboxId: string | null | undefined, contact: string | undefined, enabled: boolean) {
  const [entries, setEntries] = useState<Record<string, EmailCustomerEntry>>({});
  const cacheRef = useRef(entries);
  const [retryNonce, setRetryNonce] = useState(0);
  const lastRetryRef = useRef(0);
  const email = contact?.trim().toLowerCase() || "";
  useEffect(() => {
    if (!enabled || !mailboxId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    const force = retryNonce !== lastRetryRef.current;
    lastRetryRef.current = retryNonce;
    const key = `${mailboxId}:${email}`;
    const previous = cacheRef.current[key];
    if (!force && previous?.status === "ready" && Date.now() - previous.updatedAt < 30_000) return;
    let active = true;
    const controller = new AbortController();
    const update = (entry: EmailCustomerEntry) => {
      if (!active) return;
      cacheRef.current = { ...cacheRef.current, [key]: entry };
      setEntries(cacheRef.current);
    };
    update({ status: "pending", context: previous?.context, updatedAt: previous?.updatedAt || 0 });
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const params = new URLSearchParams({ mailboxId, email });
        const response = await fetch(`/api/email/customer-context?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || result.email !== email || !result.context || typeof result.context !== "object") throw new Error("Unable to load customer details.");
        update({ status: "ready", context: result.context as EmailCustomerContext, updatedAt: Date.now() });
      } catch { update({ status: "error", context: previous?.context, updatedAt: previous?.updatedAt || 0 }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [enabled, mailboxId, email, retryNonce]);
  const retry = useCallback(() => setRetryNonce(value => value + 1), []);
  const revalidate = useCallback(async () => {
    const entry = cacheRef.current[`${mailboxId}:${email}`];
    if (entry?.status === "pending" || entry && Date.now() - entry.updatedAt < 30_000) return;
    setRetryNonce(value => value + 1);
  }, [mailboxId, email]);
  useBackgroundRefresh(revalidate, enabled && Boolean(mailboxId && email), 30);
  return { entries, retry };
}
