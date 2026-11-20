"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function PaymentStatus({ id, initialStatus, initialExpired, workspaceId }: { id: string; initialStatus: string; initialExpired: boolean; workspaceId: string }) {
  const router = useRouter();
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
      if (!response.ok) throw new Error("Unable to open this workspace. Please retry or contact support.");
      router.replace("/workspaces/setup");
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
  }, [id, router, retry, status]);
  return <div className="mt-6 space-y-4 text-center">
    <p role="status" aria-live="polite" className="font-medium">{status === "paid" ? "Payment confirmed. Opening your workspace…" : status === "refunded" ? "This payment was refunded." : status === "closed" ? "This payment was closed." : expired ? "This QR code has expired." : "Waiting for your Alipay payment…"}</p>
    {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    {(status === "pending" || (status === "paid" && error)) && <button onClick={() => setRetry(value => value + 1)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">{status === "paid" ? "Open workspace" : "I’ve paid — check payment"}</button>}
    {(expired || status === "closed" || status === "refunded") && <p className="text-sm"><Link className="underline underline-offset-4" href={`/subscribe?workspace=${workspaceId}`}>Return to subscriptions</Link></p>}
    {expired && status === "pending" && <p className="text-xs text-slate-500">Already paid? Check payment before starting another checkout.</p>}
  </div>;
}
