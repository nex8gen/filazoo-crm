"use client";

import type { ComponentProps } from "react";
import { FlowActionCard } from "@/components/flow-action-card";
import { FlowEmailMetrics, FlowEmailStatus, useEmailPerformance } from "@/components/flow-email-performance";
import { flowEmailContent } from "@/lib/flow-email-editor";
import { flowEmailStatus, type JsonConfig } from "@/lib/flows";

export function FlowEmailActionCard({ actionId, config, ...props }: ComponentProps<typeof FlowActionCard> & { actionId: string; config: JsonConfig }) {
  const context = useEmailPerformance();
  const saved = context.savedIds.includes(actionId) && Boolean(config.templateId);
  const expanded = saved && context.status !== "draft";
  const content = flowEmailContent(config);
  const name = String(config.emailName || context.emailNames?.[actionId] || "Email");
  return <FlowActionCard {...props} label={name} expanded={expanded} body={expanded ? <div className="wf-email-card-content"><p className="wf-email-card-subject" title={content.subject}>{content.subject}</p><FlowEmailMetrics actionId={String(config.performanceId || actionId)} card /></div> : undefined}
    detail={<div className="wf-email-card-footer"><span className="wf-email-card-tags">{Number(config.smartSendingHours) > 0 ? <span>Smart sending</span> : null}{config.utmTracking !== false ? <span>UTM tracking</span> : null}</span><FlowEmailStatus status={flowEmailStatus(config)} onChange={context.onEmailStatusChange ? status => context.onEmailStatusChange?.(actionId, status) : undefined} disabled={context.disabled} compact /></div>} />;
}
