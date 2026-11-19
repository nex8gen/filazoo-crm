"use client";

import type { ComponentProps } from "react";
import { RefreshCw } from "lucide-react";
import { FlowActionCard } from "@/components/flow-action-card";
import { useEmailPerformance } from "@/components/flow-email-performance";
import { Button } from "@/components/ui/button";
import { emptyActionPerformance } from "@/lib/flow-email-performance";
import { flowActionConfigIssue, type JsonConfig } from "@/lib/flows";

export function FlowReportedActionCard({ actionId, config, ...props }: ComponentProps<typeof FlowActionCard> & { actionId: string; config: JsonConfig }) {
  const context = useEmailPerformance();
  const performanceId = String(config.performanceId || actionId);
  const saved = context.savedIds.includes(actionId) || context.savedIds.includes(performanceId);
  const expanded = saved && context.status !== "draft" && context.reportsVisible && Boolean(props.kind && !flowActionConfigIssue(props.kind, config));
  const value = context.report?.stepActions?.[performanceId] ?? emptyActionPerformance();
  const available = Boolean(context.report?.stepActions) && !context.error;
  const metrics = [["Completed", value.completed], ["Waiting", value.waiting], ["Needs attention", value.review], ["Skipped", value.skipped]] as const;
  return <FlowActionCard {...props} expanded={expanded} body={expanded ? <div data-no-drag className="wf-email-card-content wf-action-card-content" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <div className="wf-email-card-metrics" aria-label={`${props.label} analytics`} aria-busy={context.loading}>
      <p className="wf-email-metrics-period">Last 30 days</p>
      <dl>{metrics.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{available ? count.toLocaleString("en") : "—"}</dd></div>)}</dl>
      {context.error ? <div className="wf-email-metrics-error" role="status"><span>Performance unavailable</span><Button variant="ghost" size="icon-sm" aria-label="Retry action performance" onClick={context.refresh}><RefreshCw /></Button></div> : context.loading && !context.report ? <p className="wf-email-metrics-caption" role="status">Loading performance…</p> : null}
    </div>
  </div> : undefined} />;
}
