"use client";

import type { ComponentProps } from "react";
import { FlowActionCard } from "@/components/flow-action-card";
import { FlowEmailMetrics, FlowEmailStatus, useEmailPerformance } from "@/components/flow-email-performance";
import { flowEmailContent } from "@/lib/flow-email-editor";
import { flowEmailStatus, type JsonConfig } from "@/lib/flows";

export function FlowEmailActionCard({ actionId, config, ...props }: ComponentProps<typeof FlowActionCard> & { actionId: string; config: JsonConfig }) {
  const context = useEmailPerformance();
  const ai = props.kind === "ai_auto_reply";
  const saved = (context.savedIds.includes(actionId) || context.savedIds.includes(String(config.performanceId || actionId))) && (ai || Boolean(config.templateId));
  const expanded = saved && context.status !== "draft" && context.reportsVisible !== false;
  const content = flowEmailContent(config);
  const name = ai ? props.label : String(config.emailName || context.emailNames?.[actionId] || "Email");
  return <FlowActionCard {...props} label={name} expanded={expanded} body={expanded ? <div className="wf-email-card-content">{!ai ? <p className="wf-email-card-subject" title={content.subject}>{content.subject}</p> : null}<FlowEmailMetrics actionId={String(config.performanceId || actionId)} card ai={ai} /></div> : undefined}
    detail={<div className="wf-email-card-footer"><span className="wf-email-card-tags">{Number(config.smartSendingHours) > 0 ? <span>Smart sending</span> : null}{ai && config.attachCatalog ? <span>Catalog</span> : null}{config.utmTracking !== false ? <span>UTM tracking</span> : null}</span><FlowEmailStatus status={flowEmailStatus(config)} onChange={context.onEmailStatusChange ? status => context.onEmailStatusChange?.(actionId, status) : undefined} disabled={context.disabled} compact /></div>} />;
}
