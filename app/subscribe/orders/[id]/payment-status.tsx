"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import styles from "@/components/onboarding-completion.module.css";

export function PaymentStatus({ id, initialStatus, initialExpired, workspaceId, kind, discounted = false }: { id: string; initialStatus: string; initialExpired: boolean; workspaceId: string; kind?: "subscription" | "credits"; discounted?: boolean }) {
  const router = useRouter();
  const isRecharge = kind === "credits";
  const [status, setStatus] = useState(initialStatus);
  const [expired, setExpired] = useState(initialExpired);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (status !== "pending" && status !== "paid") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let checks = 0;
    async function finish() {
      const response = await fetch(`/api/billing/orders/${id}/complete`, { method: "POST", signal: controller.signal });
      if (!response.ok) throw new Error(isRecharge ? "Unable to open your credit balance. Please retry or contact support." : "Unable to open this workspace. Please retry or contact support.");
      router.replace(isRecharge ? "/settings/credits" : "/workspaces/setup");
      router.refresh();
    }
    async function poll() {
      if (document.visibilityState === "hidden" || !navigator.onLine) { timer = setTimeout(poll, 5000); return; }
      try {
        if (status === "paid") { await finish(); return; }
        const response = await fetch(`/api/billing/orders/${id}/status`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not confirm payment yet. Please retry; your payment will not be charged again.");
        const data = await response.json();
        if (controller.signal.aborted) return;
        setStatus(data.status); setExpired(Boolean(data.expired)); setError("");
        if (data.status === "paid") return; // A new effect completes the confirmed order.
        if (data.status !== "pending") return;
        if (data.expired || ++checks >= 180) return;
        timer = setTimeout(poll, 5000);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to check payment."); }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, router, retry, status, isRecharge]);
  return <div className={styles.status}>
    <p role="status" aria-live="polite" className={styles.statusMessage}>{!error && (status === "paid" || (status === "pending" && !expired)) ? <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" /> : null}{status === "paid" ? isRecharge ? "Credits added. Opening your balance…" : discounted ? "Plan activated. Opening your workspace…" : "Payment confirmed. Opening your workspace…" : status === "refunded" ? "This payment was refunded." : status === "closed" ? "This payment was closed." : expired ? "This QR code has expired." : "Waiting for your Alipay payment…"}</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {(status === "pending" || (status === "paid" && error)) && <button type="button" onClick={() => setRetry(value => value + 1)} className={styles.retry}>{status === "paid" ? isRecharge ? "View AI credits" : "Open workspace" : "I’ve paid — check payment"}</button>}
    {(expired || status === "closed" || status === "refunded") && <p><Link className={styles.returnLink} href={isRecharge ? "/settings/credits#add-ai-credits" : `/subscribe?workspace=${workspaceId}`}>{isRecharge ? "Return to AI credits" : "Return to subscriptions"}</Link></p>}
    {expired && status === "pending" && <p className={styles.note}>Already paid? Check payment before starting another checkout.</p>}
  </div>;
}
