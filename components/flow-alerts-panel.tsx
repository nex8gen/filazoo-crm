"use client";

import { useId, useState, type Ref } from "react";
import { AlertTriangle, Bell, CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";
import { flowAlertKey, type FlowAlert } from "@/lib/flow-alerts";

export function FlowAlertsBell({ count, open, panelId, onToggle, buttonRef }: { count: number; open: boolean; panelId: string; onToggle: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  const { t } = useLanguage();
  return <Button ref={buttonRef} type="button" variant="ghost" size="icon-sm" className="wf-icon-button wf-alerts-bell" aria-label={t("Workflow alerts")} aria-describedby={`${panelId}-count`} title={t("Workflow alerts")} aria-expanded={open} aria-controls={panelId} data-active={open || undefined} onClick={onToggle}>
    <Bell /><span className="sr-only" id={`${panelId}-count`} aria-live="polite">{count} {t("active alerts")}</span>{count ? <span aria-hidden="true" className="wf-alert-count">{count > 99 ? "99+" : count}</span> : null}
  </Button>;
}

export function FlowAlertsPanel({ id, active, dismissed, canEdit, onClose, onReview, onDismiss, onRestore }: {
  id: string; active: FlowAlert[]; dismissed: FlowAlert[]; canEdit: boolean; onClose: () => void;
  onReview: (alert: FlowAlert) => void; onDismiss: (alert: FlowAlert) => void; onRestore: (alert: FlowAlert) => void;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"active" | "dismissed">("active");
  const tabId = useId();
  const visible = tab === "active" ? active : dismissed;
  return <aside className="wf-panel wf-alerts-panel" id={id} aria-label={t("Workflow alerts")} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="wf-alerts-heading"><h2>Alerts</h2><Button type="button" variant="ghost" size="icon-sm" aria-label={t("Close workflow alerts")} onClick={onClose}><X /></Button></div>
    <div className="wf-alert-tabs" role="tablist" aria-label={t("Workflow alert views")} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "active" : event.key === "End" ? "dismissed" : tab === "active" ? "dismissed" : "active";
      setTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    }}>
      {(["active", "dismissed"] as const).map(value => <button type="button" key={value} role="tab" id={`${tabId}-${value}`} aria-controls={`${tabId}-content`} data-tab={value} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{t(value === "active" ? "Active" : "Dismissed")}<span>{value === "active" ? active.length : dismissed.length}</span></button>)}
    </div>
    <div className="wf-alerts-content scroll-surface" role="tabpanel" id={`${tabId}-content`} aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
      {visible.length ? visible.map(alert => <article className="wf-alert-card" data-severity={alert.severity} key={flowAlertKey(alert)}>
        <AlertTriangle aria-hidden="true" /><div><h3>{t(alert.title)}</h3>{alert.actionLabel ? <p className="wf-alert-location">{t(alert.actionLabel)} · {t("Step")} {alert.step}{alert.trail?.length ? <span data-no-translate> · {alert.trail.join(" / ")}</span> : null}</p> : null}<p>{t(alert.detail)}</p></div>
        <div className="wf-alert-card-actions">{tab === "active" ? <Button type="button" variant="ghost" size="sm" onClick={event => { onDismiss(alert); event.currentTarget.closest("aside")?.querySelector<HTMLButtonElement>('[data-tab="active"]')?.focus(); }}>Dismiss</Button> : <Button type="button" variant="ghost" size="sm" onClick={event => { onRestore(alert); setTab("active"); event.currentTarget.closest("aside")?.querySelector<HTMLButtonElement>('[data-tab="active"]')?.focus(); }}>Restore</Button>}<Button type="button" variant="outline" size="sm" onClick={() => onReview(alert)}>{canEdit && alert.title.startsWith("Set up") ? "Set up" : "Review"}</Button></div>
      </article>) : <div className="wf-alerts-empty"><CircleCheck aria-hidden="true" /><strong>{tab === "active" ? "No active alerts" : "No dismissed alerts"}</strong><p>{tab === "active" ? "Setup issues for this workflow will appear here." : "Alerts you dismiss will appear here while the issue remains."}</p></div>}
    </div>
  </aside>;
}
