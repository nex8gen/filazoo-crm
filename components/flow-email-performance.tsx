"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Circle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { emailRate, emptyEmailPerformance, type EmailPerformanceReport } from "@/lib/flow-email-performance";
import type { FlowStatus } from "@/lib/flows";

type PerformanceContext = { status: FlowStatus; savedIds: string[]; emailNames?: Record<string, string>; report: EmailPerformanceReport | null; loading: boolean; error: string; refresh: () => void; onEmailStatusChange?: (actionId: string, status: FlowStatus) => void; disabled: boolean };
const Context = createContext<PerformanceContext>({ status: "draft", savedIds: [], report: null, loading: false, error: "", refresh() {}, disabled: true });
export function useEmailPerformance() { return useContext(Context); }

export function FlowEmailPerformanceProvider({ flowId, version, status, savedIds, emailNames, disabled, onEmailStatusChange, children }: { flowId: string | null; version?: string; status: FlowStatus; savedIds: string[]; emailNames?: Record<string, string>; disabled: boolean; onEmailStatusChange: (actionId: string, status: FlowStatus) => void; children?: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ flowId: string | null; report: EmailPerformanceReport | null; loading: boolean; error: string }>({ flowId: null, report: null, loading: false, error: "" });
  useEffect(() => {
    if (!flowId || status === "draft") return;
    let disposed = false;
    let controller: AbortController | null = null;
    async function load() {
      controller?.abort();
      const request = new AbortController(); controller = request;
      const timeout = window.setTimeout(() => request.abort(), 20_000);
      setState(current => ({ flowId, report: current.flowId === flowId ? current.report : null, loading: true, error: "" }));
      try {
        const response = await fetch(`/api/flows/${flowId}/email-performance`, { cache: "no-store", signal: request.signal });
        const result = await response.json();
        if (!response.ok || !result.ok || !result.report?.actions || typeof result.report.asOf !== "string") throw new Error(result.error || "Unable to load email performance.");
        if (!disposed && controller === request) setState({ flowId, report: result.report, loading: false, error: "" });
      } catch (cause) {
        if (!disposed && controller === request) setState({ flowId, report: null, loading: false, error: request.signal.aborted ? "Loading timed out. Please try again." : cause instanceof Error ? cause.message : "Unable to load email performance." });
      } finally { window.clearTimeout(timeout); }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, [flowId, version, status, revision]);
  const current = state.flowId === flowId && status !== "draft" ? state : { report: null, loading: Boolean(flowId && status !== "draft"), error: "" };
  return <Context.Provider value={{ status, savedIds, emailNames, ...current, refresh: () => setRevision(value => value + 1), onEmailStatusChange, disabled }}>{children}</Context.Provider>;
}

export function FlowEmailStatus({ status, onChange, disabled = false, compact = false }: { status: FlowStatus; onChange?: (status: FlowStatus) => void; disabled?: boolean; compact?: boolean }) {
  const emailStatus = status === "live" ? "live" : "draft";
  return <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" className={`wf-email-status${compact ? " is-compact" : ""}`} data-status={emailStatus} aria-label={`Email status: ${emailStatus}`} title="Applies only to this email" disabled={disabled || !onChange}><Circle />{emailStatus === "live" ? "Live" : "Draft"}<ChevronDown /></Button>} /><DropdownMenuContent align="end">{(["draft", "live"] as const).map(value => <DropdownMenuItem key={value} disabled={value === emailStatus} onClick={() => { if (!disabled) onChange?.(value); }}>{value === "live" ? "Live" : "Draft"}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

export function FlowEmailMetrics({ actionId, card = false }: { actionId: string; card?: boolean }) {
  const context = useEmailPerformance();
  const value = context.report?.actions[actionId] ?? emptyEmailPerformance();
  const available = Boolean(context.report) && !context.error;
  const number = (count: number) => available ? count.toLocaleString("en") : "—";
  return <div className={card ? "wf-email-card-metrics" : "wf-email-performance-metrics"} aria-busy={context.loading}>
    <dl><div><dt>Open rate</dt><dd>{available ? emailRate(value.openRate, value.opens) : "—"}</dd></div><div><dt>Click rate</dt><dd>{available ? emailRate(value.clickRate, value.clicks) : "—"}</dd></div><div><dt title="Order attribution is not available for workflow emails">Placed order</dt><dd>—</dd></div>
      {card ? <><div className="wf-email-metric-divider"><dt>Waiting</dt><dd>{number(value.waiting)}</dd></div><div><dt>Review</dt><dd>{number(value.review)}</dd></div><div><dt title="Accepted by the sending server; inbox delivery is not confirmed">Sent</dt><dd>{number(value.sent)}</dd></div><div><dt>Skipped</dt><dd>{number(value.skipped)}</dd></div></> : null}
    </dl>
    {!card && context.loading && !context.report ? <p className="wf-email-metrics-caption" role="status">Loading performance…</p> : null}
    {!card && available && value.sent === 0 ? <p className="wf-email-metrics-caption">No sends recorded for this email in the last 30 days.</p> : null}
    {context.error ? <div className="wf-email-metrics-error" role="status"><span>Performance unavailable</span><Button variant="ghost" size="icon-sm" aria-label="Retry email performance" onClick={context.refresh}><RefreshCw /></Button></div> : null}
  </div>;
}
