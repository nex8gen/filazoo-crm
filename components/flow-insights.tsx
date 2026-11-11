"use client";
import { Workflow } from "lucide-react";

import { EmptyState } from "@/components/data-state";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Run = {
  id: string;
  status: string;
  current_step: number;
  next_run_at: string | null;
  started_at: string;
  retry?: { reason: string; category: string; attempt: number } | null;
  retryable?: boolean;
  uncertain?: boolean;
  canCancel?: boolean;
  sentCount?: number;
  skippedCount?: number;
  flow_run_logs: Array<{ id: string; result: Record<string, unknown> | null; error: string | null; created_at: string }>;
};

export function FlowInsights({ flowId }: { flowId: string | null }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  async function recover(runId: string, action: "retry" | "cancel") {
    setBusy(runId);
    setError("");
    try {
      const response = await fetch(`/api/flows/${flowId}/runs/${runId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to update this run.");
      setLoading(true);
      setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update this run."); }
    finally { setBusy(null); }
  }
  useEffect(() => {
    if (!flowId) return;
    const controller = new AbortController();
    fetch(`/api/flows/${flowId}/runs?${new URLSearchParams({ status, page: String(page) })}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load run history.");
        if (controller.signal.aborted) return;
        setError("");
        setRuns(result.runs);
        setHasMore(result.hasMore === true);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load run history."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [flowId, revision, status, page]);

  if (!flowId) return <p className="text-sm text-muted-foreground">Save this workflow to see its run history.</p>;
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Recent runs</h3><Button size="sm" variant="outline" disabled={loading} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Refresh</Button></div>
    <select aria-label="Run status" value={status} disabled={loading} onChange={event => { setStatus(event.target.value); setPage(0); setRuns([]); setLoading(true); }} className="h-9 w-full rounded-md border bg-background px-3 text-xs focus-visible:ring-2 focus-visible:ring-ring"><option value="all">All runs</option><option value="failed">Failed runs</option><option value="active">In progress</option><option value="done">Completed</option><option value="cancelled">Stopped</option></select>
    {loading ? <p role="status" className="text-xs text-muted-foreground">Loading run history…</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {!loading && !error && !runs.length ? <EmptyState compact icon={Workflow} title={status === "all" ? "No contacts have entered this workflow yet." : "No runs match this status."} /> : null}
    {runs.map((run) => <details key={run.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs"><strong className="capitalize">{run.status === "active" && run.retry ? ["configuration", "data"].includes(run.retry.category) || run.retry.attempt > 5 ? "Blocked — waiting for a fix" : "Retry scheduled" : run.status}</strong> · Step {run.current_step + 1}<span className="mt-1 block text-muted-foreground">{new Date(run.started_at).toLocaleString()}</span></summary>
      {run.status === "active" && run.retry ? <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-400">{run.retry.reason}</p> : null}
      {run.status === "failed" ? <p className="mt-2 break-words text-xs leading-5 text-destructive">{[...run.flow_run_logs].sort((a, b) => b.created_at.localeCompare(a.created_at)).find(log => log.error)?.error || "Review the run events for the failed action."}</p> : null}
      {run.next_run_at ? <p className="mt-3 text-xs">Scheduled: {new Date(run.next_run_at).toLocaleString()}</p> : null}
      <p className="mt-2 text-xs font-medium">{run.sentCount ?? 0} emails sent · {run.skippedCount ?? 0} messages skipped{run.status === "done" && !run.sentCount ? " · Journey ended without sending an email" : ""}</p>
      {run.uncertain ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Delivery may have started. Check the sender&apos;s Sent folder before taking further action. Retry is disabled to prevent duplicate email.</p> : null}
      {run.retryable || run.canCancel ? <div className="mt-3 flex flex-wrap gap-2">{run.retryable ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void recover(run.id, "retry")}>Recheck and retry this action</Button> : null}{run.canCancel ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void recover(run.id, "cancel")}>Stop this run</Button> : null}</div> : null}
      <ol className="mt-3 space-y-2">{[...run.flow_run_logs].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((log) => <li key={log.id} className={`rounded bg-muted/40 p-2 text-xs ${log.error ? "text-destructive" : "text-muted-foreground"}`}>
        {log.error || String(log.result?.action || "Run event").replaceAll("_", " ")}
        {log.result?.reason ? <span className="mt-1 block">{String(log.result.reason)}</span> : null}
        {log.result?.branch ? <span className="mt-1 block">Branch: {String(log.result.branch).replaceAll("_", " ")}</span> : null}
      </li>)}</ol>
    </details>)}
    {!loading && !error && (page > 0 || hasMore) ? <div className="flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => { setLoading(true); setRuns([]); setPage(value => value - 1); }}>Previous</Button><span className="text-xs text-muted-foreground">Page {page + 1}</span><Button size="sm" variant="outline" disabled={!hasMore} onClick={() => { setLoading(true); setRuns([]); setPage(value => value + 1); }}>Next</Button></div> : null}
  </div>;
}
