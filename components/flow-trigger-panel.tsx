"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlowCustomerPicker } from "@/components/flow-customer-picker";
import { companyStatuses, emailCategories, flowLeadLists, triggerLabels, type FlowInput, type JsonConfig, type TriggerType } from "@/lib/flows";
import { isSegmentAudienceFlow, segmentCompaniesHref } from "@/lib/segment-flows";
import { applyTriggerEvent, applyTriggerProfiles, editableTriggerTypes, triggerEventDraft, triggerProfileFields, triggerProfileSummary, triggerSettingsError } from "@/lib/flow-trigger-editor";

type Option = { id: string; label: string };
type Props = {
  flow: FlowInput;
  onChange: (flow: FlowInput) => void;
  onClose: () => void;
  onPreview: () => void;
  disabled: boolean;
  filterOptions: { segments: string[]; countries: string[] };
  receivingMailboxes: Option[];
};

function TriggerChoice({ label, value, options, onChange, disabled }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled: boolean }) {
  return <div className="wf-trigger-field"><Label>{label}</Label><Select value={value} onValueChange={next => { if (next) onChange(next); }} disabled={disabled}><SelectTrigger className="w-full" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
}

export function FlowTriggerPanel({ flow, onChange, onClose, onPreview, disabled, filterOptions, receivingMailboxes }: Props) {
  const [view, setView] = useState<"overview" | "event" | "filters">("overview");
  const [pending, setPending] = useState<{ type: TriggerType; config: JsonConfig } | null>(null);
  const [error, setError] = useState("");
  const fixedSegment = isSegmentAudienceFlow(flow.triggerType, flow.triggerConfig);
  const config = pending?.config ?? flow.triggerConfig;
  const type = pending?.type ?? flow.triggerType;
  const summaries = triggerProfileSummary(flow);
  const segments = [...new Set([String(config.segment || ""), ...filterOptions.segments])].filter(Boolean);
  const countries = [...new Set([String(config.country || ""), ...filterOptions.countries])].filter(Boolean);
  const categories = [...new Set([typeof config.category === "string" ? config.category : "", ...emailCategories])].filter(Boolean);
  const changed = pending !== null && (pending.type !== flow.triggerType || JSON.stringify(pending.config) !== JSON.stringify(flow.triggerConfig));
  const open = (next: "event" | "filters") => { setPending({ type: flow.triggerType, config: { ...flow.triggerConfig } }); setError(""); setView(next); };
  const cancel = () => { setPending(null); setError(""); setView("overview"); };
  const setField = (key: string, value: JsonConfig[string] | undefined) => {
    if (!pending || disabled) return;
    const next = { ...pending.config };
    if (value === undefined) delete next[key]; else next[key] = value;
    setPending({ ...pending, config: next }); setError("");
  };
  const save = () => {
    if (!pending || disabled) return;
    const result = view === "event" ? applyTriggerEvent(flow, pending.type, pending.config) : { triggerType: flow.triggerType, triggerConfig: applyTriggerProfiles(flow, pending.config) };
    const problem = triggerSettingsError(result.triggerType, result.triggerConfig);
    if (problem) { setError(problem); return; }
    onChange({ ...flow, ...result }); cancel();
  };
  const updateReentry = (change: JsonConfig) => { if (!disabled && !fixedSegment) onChange({ ...flow, triggerConfig: { ...flow.triggerConfig, ...change } }); };
  const reentryMode = String(flow.triggerConfig.reentryMode || "every_event");
  const eventDetail = flow.triggerType === "lead_added_to_list" ? String(flow.triggerConfig.listId || "Choose a lead list")
    : flow.triggerType === "category_changed" ? String(flow.triggerConfig.category || "Choose a customer tag")
      : flow.triggerType === "company_segment_changed" ? String(flow.triggerConfig.segment || "Choose a segment")
        : flow.triggerType === "email_received" ? receivingMailboxes.find(mailbox => mailbox.id === flow.triggerConfig.receivingMailboxId)?.label || (flow.triggerConfig.receivingMailboxId ? "Selected mailbox is unavailable" : "Any available mailbox")
          : flow.triggerType === "no_reply" ? `${flow.triggerConfig.amount ?? 2} ${flow.triggerConfig.unit || "days"}${flow.triggerConfig.businessDays ? " · business days only" : ""}`
            : flow.triggerType === "new_lead" ? "When a new lead is created" : "Choose a supported event";
  const scopeNote = flow.triggerConfig.flowScope ? <div className="wf-trigger-scope"><LockKeyhole /><div><strong>{flow.triggerConfig.flowScope === "company" ? "Only this company" : "Only this email address"}</strong><span data-no-translate>{String(flow.triggerConfig.scopeLabel || "Selected audience")}</span></div></div> : null;

  return <aside className="wf-panel wf-inspector wf-trigger-panel" aria-label="Trigger settings">
    <div className="wf-settings-heading">
      {view === "overview" ? <span className="wf-settings-icon"><Zap /></span> : <Button variant="ghost" size="icon-sm" aria-label="Back to trigger" onClick={cancel}><ArrowLeft /></Button>}
      <div className="wf-trigger-panel-title"><h2>{view === "overview" ? "Trigger" : view === "filters" ? "Profile filters" : "Trigger event"}</h2>{view !== "overview" ? <p>{view === "filters" ? "Edit profile filters" : "Choose when contacts enter"}</p> : null}</div>
      {view === "overview" ? <Button variant="ghost" size="icon-sm" aria-label="Close trigger settings" onClick={onClose}><X /></Button> : null}
    </div>
    <div className="wf-inspector-content scroll-surface">
      {view === "overview" ? <div className="wf-trigger-overview">
        <section className="wf-trigger-section">
          <div className="wf-trigger-section-heading"><div><h3>Trigger</h3><p>Contacts enter the workflow when this happens.</p></div><Button variant="outline" size="sm" onClick={onPreview}>Preview</Button></div>
          <div className="wf-trigger-event-summary"><small>{triggerLabels[flow.triggerType]}</small><div><strong data-no-translate={flow.triggerType === "company_segment_changed" || flow.triggerType === "lead_added_to_list" || undefined}>{eventDetail}</strong>{!fixedSegment ? <Button variant="ghost" size="sm" disabled={disabled} onClick={() => open("event")}>Change</Button> : null}</div></div>
          {scopeNote}
          {fixedSegment ? <div className="wf-trigger-segment-note"><p>This segment defines the audience. Existing and newly matching companies can enter after activation.</p><Link href={segmentCompaniesHref(flow.triggerConfig)}>View customers in this segment</Link></div> : null}
        </section>
        <section className="wf-trigger-section">
          <h3>Re-entry criteria</h3><p className="wf-trigger-description">Set whether contacts can enter this workflow more than once.</p>
          {fixedSegment ? <p className="wf-trigger-empty">Each company can enter this segment workflow once.</p> : <fieldset className="wf-radio-options" disabled={disabled} aria-label="Re-entry criteria">
            {[["no_reentry", "No re-entry", "Contacts enter once, even if the trigger matches again."], ["every_event", "Allow re-entry", "Contacts can re-enter whenever the trigger matches."], ["after_period", "Allow re-entry after a time period", "Contacts can re-enter after the waiting period has passed."]].map(([value, label, description]) => <label key={value}><input type="radio" name="workflow-reentry" value={value} checked={reentryMode === value} onChange={() => updateReentry({ reentryMode: value, ...(value === "after_period" ? { reentryAfterAmount: flow.triggerConfig.reentryAfterAmount ?? 30, reentryAfterUnit: flow.triggerConfig.reentryAfterUnit || "days" } : {}) })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}
            {reentryMode === "after_period" ? <div className="wf-trigger-field-pair"><div className="wf-trigger-field"><Label htmlFor="trigger-reentry-amount">Wait</Label><Input id="trigger-reentry-amount" type="number" min={1} max={3650} value={Number(flow.triggerConfig.reentryAfterAmount || 30)} onChange={event => updateReentry({ reentryAfterAmount: Math.max(1, Math.min(3650, Number(event.target.value) || 1)) })} /></div><TriggerChoice label="Wait unit" value={String(flow.triggerConfig.reentryAfterUnit || "days")} options={[{ id: "hours", label: "Hours" }, { id: "days", label: "Days" }]} onChange={value => updateReentry({ reentryAfterUnit: value })} disabled={disabled} /></div> : null}
          </fieldset>}
        </section>
        <section className="wf-trigger-section">
          <div className="wf-trigger-section-heading"><div><h3>Profile filters</h3><p>Limit entry to customers who meet these conditions.</p></div><Button variant="outline" size="sm" disabled={disabled} onClick={() => open("filters")}>{summaries.length ? "Edit" : "Add"}</Button></div>
          {summaries.length ? <><ul className="wf-trigger-filter-summary">{summaries.map(summary => <li key={summary}>{summary}</li>)}</ul><p className="wf-trigger-caption">All conditions must match.</p></> : <p className="wf-trigger-empty">No profile filters applied.</p>}
        </section>
        <p className="wf-trigger-caption">A conversation can have only one active run in this workflow.</p>
      </div> : <div className="wf-trigger-editor">
        <p className="wf-panel-description">{view === "filters" ? "Choose which customers can enter. All selected conditions must match." : "Choose a CRM event and its entry conditions."}</p>
        {view === "event" ? <>
          <TriggerChoice label="Trigger event" value={type} options={[...(type === "pipeline_stage_changed" ? [{ id: type, label: "Retired sales trigger — choose a supported event" }] : []), ...editableTriggerTypes.map(id => ({ id, label: triggerLabels[id] }))]} onChange={value => { const next = value as TriggerType; setPending({ type: next, config: triggerEventDraft(flow, next, filterOptions.segments) }); setError(""); }} disabled={disabled} />
          {type === "category_changed" ? <TriggerChoice label="Customer tag" value={String(config.category || emailCategories[0])} options={categories.map(value => ({ id: value, label: value }))} onChange={value => setField("category", value)} disabled={disabled} /> : null}
          {type === "no_reply" ? <><div className="wf-trigger-field-pair"><div className="wf-trigger-field"><Label htmlFor="trigger-duration">Duration</Label><Input id="trigger-duration" type="number" min={1} max={365} value={Number(config.amount ?? 2)} onChange={event => setField("amount", Number(event.target.value))} disabled={disabled} /></div><TriggerChoice label="Duration unit" value={String(config.unit || "days")} options={[{ id: "hours", label: "Hours" }, { id: "days", label: "Days" }]} onChange={value => setField("unit", value)} disabled={disabled} /></div><label className="wf-trigger-checkbox"><Checkbox checked={Boolean(config.businessDays)} disabled={disabled} onCheckedChange={checked => setField("businessDays", checked === true)} /><span>Count business days only<small>Skip weekends when checking the trigger.</small></span></label></> : null}
          {type === "lead_added_to_list" ? <TriggerChoice label="Lead list" value={String(config.listId || flowLeadLists[0])} options={flowLeadLists.map(value => ({ id: value, label: value }))} onChange={value => setField("listId", value)} disabled={disabled} /> : null}
          {type === "company_segment_changed" ? segments.length ? <TriggerChoice label="Company segment" value={String(config.segment || "")} options={segments.map(value => ({ id: value, label: value }))} onChange={value => setField("segment", value)} disabled={disabled} /> : <div className="wf-trigger-field"><Label htmlFor="trigger-segment">Company segment</Label><Input id="trigger-segment" value={String(config.segment || "")} onChange={event => setField("segment", event.target.value)} disabled={disabled} /></div> : null}
          {type === "email_received" ? <><TriggerChoice label="Receiving mailbox" value={String(config.receivingMailboxId || "__any")} options={[{ id: "__any", label: "Any available mailbox" }, ...receivingMailboxes, ...(config.receivingMailboxId && !receivingMailboxes.some(mailbox => mailbox.id === config.receivingMailboxId) ? [{ id: String(config.receivingMailboxId), label: "Selected mailbox is unavailable" }] : [])]} onChange={value => setField("receivingMailboxId", value === "__any" ? undefined : value)} disabled={disabled} /><p className="wf-trigger-caption">Only new customer messages received after activation enroll. Automatic responses are excluded.</p></> : null}
          {scopeNote}
        </> : <>
          {scopeNote || (fixedSegment ? <div className="wf-trigger-segment-note">The segment audience stays fixed while you edit these filters.</div> : <FlowCustomerPicker config={config} onChange={next => { if (pending && !disabled) { setPending({ ...pending, config: next }); setError(""); } }} disabled={disabled} />)}
          {flow.triggerType !== "company_segment_changed" ? <TriggerChoice label="Company segment" value={String(config.segment || "__any")} options={[{ id: "__any", label: "Any segment" }, ...segments.map(value => ({ id: value, label: value }))]} onChange={value => setField("segment", value === "__any" ? undefined : value)} disabled={disabled} /> : null}
          <TriggerChoice label="Country" value={String(config.country || "__any")} options={[{ id: "__any", label: "Any country" }, ...countries.map(value => ({ id: value, label: value }))]} onChange={value => setField("country", value === "__any" ? undefined : value)} disabled={disabled} />
          <TriggerChoice label="Company status" value={String(config.companyStatus || "__any")} options={[{ id: "__any", label: "Any status" }, ...companyStatuses.map(value => ({ id: value, label: value.charAt(0).toUpperCase() + value.slice(1) }))]} onChange={value => setField("companyStatus", value === "__any" ? undefined : value)} disabled={disabled} />
          <div className="wf-trigger-field"><Label htmlFor="trigger-min-fit-score">Minimum fit score</Label><Input id="trigger-min-fit-score" type="number" min={1} max={10} placeholder="Any score" value={typeof config.minFitScore === "number" ? config.minFitScore : ""} onChange={event => setField("minFitScore", event.target.value === "" ? undefined : Number(event.target.value))} disabled={disabled} /><small>Leave empty for any score, or enter a score from 1 to 10.</small></div>
          <Button variant="ghost" size="sm" className="wf-trigger-clear" disabled={disabled} onClick={() => { if (!pending) return; const next = { ...pending.config }; triggerProfileFields(flow).forEach(key => { delete next[key]; }); setPending({ ...pending, config: next }); setError(""); }}>Clear profile filters</Button>
        </>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>}
    </div>
    <div className="wf-settings-footer">{view === "overview" ? <Button variant="outline" size="sm" onClick={onClose}>Close</Button> : <><Button variant="outline" size="sm" onClick={cancel}>Cancel</Button><Button size="sm" disabled={disabled || !changed} onClick={save}>Save</Button></>}</div>
  </aside>;
}
