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
  flow_run_logs: Array<{ id: string; result: Record<string, unknown> | null; error: string | null; created_at: string }>;
};

export function FlowInsights({ flowId }: { flowId: string | null }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!flowId) return;
    const controller = new AbortController();
    fetch(`/api/flows/${flowId}/runs`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load run history.");
        setError("");
        setRuns(result.runs);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load run history."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [flowId, revision]);

  if (!flowId) return <p className="text-sm text-muted-foreground">Save this workflow to see its run history.</p>;
  return <div className="space-y-4">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Recent runs</h3><Button size="sm" variant="outline" disabled={loading} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Refresh</Button></div>
    {loading ? <p role="status" className="text-xs text-muted-foreground">Loading run history…</p> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {!loading && !error && !runs.length ? <EmptyState compact icon={Workflow} title="No contacts have entered this workflow yet." /> : null}
    {runs.map((run) => <details key={run.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs"><strong className="capitalize">{run.status}</strong> · Step {run.current_step + 1}<span className="mt-1 block text-muted-foreground">{new Date(run.started_at).toLocaleString()}</span></summary>
      {run.next_run_at ? <p className="mt-3 text-xs">Scheduled: {new Date(run.next_run_at).toLocaleString()}</p> : null}
      <ol className="mt-3 space-y-2">{[...run.flow_run_logs].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((log) => <li key={log.id} className={`rounded bg-muted/40 p-2 text-xs ${log.error ? "text-destructive" : "text-muted-foreground"}`}>
        {log.error || String(log.result?.action || "Run event").replaceAll("_", " ")}
        {log.result?.reason ? <span className="mt-1 block">{String(log.result.reason)}</span> : null}
        {log.result?.branch ? <span className="mt-1 block">Branch: {String(log.result.branch).replaceAll("_", " ")}</span> : null}
      </li>)}</ol>
    </details>)}
  </div>;
}
