"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ReplyRequestSummary } from "@/lib/customer-reply-workflow";
import { ArrowUpRight, Building2, CheckCheck, Clock3, Mail, MessageSquareText, Square } from "lucide-react";
import { activityTime } from "@/lib/task-activity";
import { CompanyAvatar } from "@/components/company-avatar";

const labels: Record<string, string> = { preparing: "Preparing", sending: "Sending", waiting: "Waiting for reply", received: "Reply received", cancelled: "Stopped", expired: "Follow-up needed", uncertain: "Check delivery", blocked: "Access changed" };
export function CustomerReplyRequests({ initial, initialError = "" }: { initial: ReplyRequestSummary[]; initialError?: string }) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (document.hidden || loading || busy.current) return;
      loading = true;
      try {
        const response = await fetch("/api/ai/reply-requests", { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load customer waits.");
        setRows(data.requests); setError("");
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to refresh customer waits."); }
      finally { loading = false; }
    }
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  async function stop(id: string) {
    if (busy.current) return;
    busy.current = true; setPending(id); setError("");
    try {
      const response = await fetch("/api/ai/reply-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "cancel" }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to stop waiting.");
      setRows((current) => current.map((row) => row.id === id ? { ...row, status: "cancelled" } : row));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to stop waiting."); }
    finally { busy.current = false; setPending(null); }
  }
  return <section aria-label="Customer replies">
    <div className="border-b bg-muted/15 px-5 py-3"><p className="text-xs text-muted-foreground">Track customer replies and the review tasks they create.</p></div>
    {error && <p role="alert" className="m-5 rounded-lg border border-destructive/15 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}
    {!rows.length && !error && <div className="flex min-h-72 flex-col items-center justify-center gap-3 px-6 text-center"><span className="grid size-12 place-items-center rounded-xl border border-primary/10 bg-primary/5 text-primary"><MessageSquareText className="size-5" /></span><h2 className="text-sm font-semibold">No customer replies to track</h2><p className="max-w-sm text-xs leading-5 text-muted-foreground">Saved customer follow-ups and their review tasks will appear here.</p></div>}
    <ul className="divide-y divide-dashed divide-border">{rows.map(row => <li key={row.id} className="px-4 py-5 sm:px-5">
      <div className="flex items-start gap-3"><CompanyAvatar company={{ id: row.company_id, name: row.company_name }} size="lg" badge={row.status === "received" ? <CheckCheck /> : <Mail />} badgeLabel={row.status === "received" ? "Review customer reply" : "Waiting for reply"} /><div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link data-no-translate className="inline-flex min-w-0 items-center gap-1 text-sm font-medium hover:text-primary" href={`/companies/${row.company_id}`}><span className="break-words">{row.company_name}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground" /></Link><span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${row.status === "received" ? "bg-primary/8 text-primary" : row.status === "uncertain" || row.status === "expired" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>{labels[row.status] ?? row.status}</span></div>
        <p data-no-translate className="mt-1.5 break-words text-xs text-muted-foreground">{row.subject}</p><p data-no-translate className="mt-3 text-sm leading-5">{row.task_title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span data-no-translate className="inline-flex items-center gap-1"><Mail className="size-3" />{row.recipient}</span><span className="inline-flex items-center gap-1"><Clock3 className="size-3" /><span>Follow-up deadline</span><time dateTime={row.expires_at}>{activityTime(row.expires_at)}</time></span></div>
        {row.last_error && <p role="alert" className="mt-3 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">{row.last_error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">{row.thread_url && <Link className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-xs hover:bg-muted" href={row.thread_url}><Mail className="size-3.5" />Open email<ArrowUpRight className="size-3" /></Link>}{row.task_id && <Link className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/15 bg-primary/5 px-2.5 text-xs text-primary hover:bg-primary/10" href={`/tasks?task=${row.task_id}`}><Building2 className="size-3.5" />Open review task<ArrowUpRight className="size-3" /></Link>}{["preparing", "sending", "waiting", "uncertain"].includes(row.status) && <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground hover:bg-destructive/5 hover:text-destructive disabled:opacity-50" disabled={pending !== null} onClick={() => stop(row.id)}><Square className="size-3" />{pending === row.id ? "Stopping…" : "Stop waiting"}</button>}</div>
      </div></div>
    </li>)}</ul>
    {rows.length === 50 && <p className="border-t px-5 py-3 text-xs text-muted-foreground">Showing your 50 most recent accessible requests.</p>}
  </section>;
}
