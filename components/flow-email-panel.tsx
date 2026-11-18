"use client";

import { lazy, Suspense, useEffect, useId, useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import { AlertTriangle, FlaskConical, Info, Mail, Monitor, MoreVertical, Smile, Smartphone, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FlowConditionEditor } from "@/components/flow-condition-editor";
import { FlowSenderField } from "@/components/flow-sender-field";
import { flowEmailContent, flowEmailTemplateNames } from "@/lib/flow-email-editor";
import { flowEmailStatus, stepConfigSchemas, type JsonConfig } from "@/lib/flows";
import { flowEditorEqual, type FlowPanelEditor } from "@/lib/flow-editor-session";
import { FlowEmailStatus } from "@/components/flow-email-performance";
import { flowUtmKeys } from "@/lib/flow-email-utm";

const TemplatePage = lazy(() => import("./flow-email-template-page").then(module => ({ default: module.FlowEmailTemplatePage })));
const SavedPreview = lazy(() => import("./flow-email-saved-preview").then(module => ({ default: module.FlowEmailSavedPreview })));
const emojis = ["😊", "👋", "✨", "🎉", "📦", "💙"];

export function FlowEmailPanel({ config, onChange, onClose, disabled, mailboxes, defaultName, sessionKey, footer, editorRef, onDirtyChange, error, onPreview, saved = false, sender, resolveSender, onSaveText, trail = [] }: {
  config: JsonConfig; onChange: (config: JsonConfig) => void; onClose: () => void; disabled: boolean;
  mailboxes: { id: string; label: string }[]; defaultName: string; sessionKey: string;
  footer?: ReactNode; editorRef?: Ref<FlowPanelEditor>; onDirtyChange?: (dirty: boolean) => void; error?: string; onPreview: () => void;
  saved?: boolean; sender?: { name: string; email: string };
  resolveSender?: (choice: JsonConfig[string]) => { name: string; email: string } | undefined; trail?: string[];
  onSaveText?: (config: JsonConfig) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [senderOpen, setSenderOpen] = useState(false);
  const [templatePage, setTemplatePage] = useState<"library" | "text" | "html" | "current" | null>(null);
  const [validationError, setValidationError] = useState("");
  const [editingDetails, setEditingDetails] = useState(!saved);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const displayedSender = resolveSender ? resolveSender(draft.mailboxId) : sender;
  const id = useId();
  const pendingConfig = { ...draft, ...(config.performanceId ? { performanceId: config.performanceId } : {}) };
  const changed = !flowEditorEqual(config, pendingConfig);
  const set = (key: string, value: JsonConfig[string]) => { if (!disabled) setDraft(current => ({ ...current, [key]: value, ...(key === "preheader" ? { hidePreviewText: false } : {}) })); };
  const content = flowEmailContent(draft);
  const templateName = String(draft.templateName || flowEmailTemplateNames[String(draft.templateId)] || "");
  const prepare = () => {
    const result = stepConfigSchemas.send_email.safeParse(pendingConfig);
    if (!result.success) { setValidationError(result.error.issues[0]?.message || "Complete the email settings."); return { ok: false as const }; }
    return { ok: true as const, config: result.data as unknown as JsonConfig };
  };
  useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  useImperativeHandle(editorRef, () => ({ hasChanges: () => changed, snapshot: () => ({ config: pendingConfig }), prepare, reset: () => { setDraft(structuredClone(config)); setValidationError(""); } }));
  function field(key: "subject" | "preheader", label: string, value: string) {
    return <div className="wf-email-field"><Label htmlFor={`${id}-${key}`}>{label}{key === "subject" ? <span className="wf-email-required">*</span> : null}</Label><div className="wf-email-input-tools">
      <Input id={`${id}-${key}`} value={value} maxLength={300} disabled={disabled} onChange={event => set(key, event.target.value)} />
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label={`Add emoji to ${label.toLowerCase()}`} disabled={disabled}><Smile /></Button>} /><DropdownMenuContent align="end">{emojis.map(emoji => <DropdownMenuItem key={emoji} onClick={() => set(key, `${value}${emoji}`)}>{emoji}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label={`Personalize ${label.toLowerCase()}`} disabled={disabled}><UserRound /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => set(key, `${value}{{first_name}}`)}>First name</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    </div></div>;
  }
  function option(key: string, checked: boolean, label: string, detail?: ReactNode) {
    return <label className="wf-email-option"><Checkbox aria-label={label} checked={checked} disabled={disabled} onCheckedChange={value => set(key, value === true)} /><span>{label}{detail ? <small>{detail}</small> : null}</span></label>;
  }
  return <aside className="wf-panel wf-inspector wf-email-panel" aria-label="Email details">
    <div className="wf-settings-heading"><span className="wf-settings-icon"><Mail /></span><h2>Email details</h2><Button variant="ghost" size="icon-sm" aria-label="Close email details" onClick={onClose}><X /></Button></div>
    <div className="wf-inspector-content scroll-surface">
      {trail.length ? <nav className="wf-action-location" aria-label="Action location"><span translate="no">{trail.join(" / ")}</span></nav> : null}
      <section className="wf-email-section wf-email-identity"><div className="wf-email-field"><Label htmlFor={`${id}-name`}>Email name</Label><Input id={`${id}-name`} value={String(draft.emailName ?? defaultName)} maxLength={200} disabled={disabled} onChange={event => set("emailName", event.target.value)} /></div><div className="wf-email-field"><Label>Status</Label><FlowEmailStatus status={flowEmailStatus(draft)} onChange={value => set("emailStatus", value)} disabled={disabled} /></div></section>
      <section className="wf-email-section"><div className="wf-email-section-heading"><h3>Subject and sender</h3>{saved ? <Button variant="outline" size="sm" disabled={disabled} aria-expanded={editingDetails} onClick={() => setEditingDetails(value => !value)}>{editingDetails ? "Done" : "Edit"}</Button> : null}</div>{editingDetails ? <>{field("subject", "Subject line", String(draft.subject ?? content.subject))}{field("preheader", "Preview text", String(draft.preheader || ""))}<Button variant="outline" size="sm" disabled={disabled} aria-expanded={senderOpen} onClick={() => setSenderOpen(open => !open)}>Edit sender</Button>{senderOpen ? <div className="wf-email-sender"><FlowSenderField value={String(draft.mailboxId || "default")} onChange={value => set("mailboxId", value)} options={mailboxes} disabled={disabled} /></div> : null}</> : <dl className="wf-email-details-summary"><div><dt>Subject line</dt><dd>{content.subject || "—"}</dd></div><div><dt>Preview text</dt><dd>{String(draft.preheader || "—")}</dd></div><div><dt>Sender name</dt><dd>{displayedSender?.name || "—"}</dd></div><div><dt>Sender email address</dt><dd>{displayedSender?.email || (draft.mailboxId === "assigned_owner" ? "Assigned salesperson’s mailbox" : "Sender unavailable")}</dd></div></dl>}
        {saved ? <div className="wf-email-ab-test" aria-disabled="true"><FlaskConical /><div><strong>Create A/B test</strong><span>A/B testing is not available for workflow emails.</span></div></div> : null}
      </section>
      <section className="wf-email-section"><div className="wf-email-template-row"><h3>Template{!draft.templateId ? <AlertTriangle aria-label="Choose a template" /> : null}</h3>{saved && templateName ? <><div className="wf-email-preview-devices" role="group" aria-label="Template preview device"><Button variant={device === "desktop" ? "outline" : "ghost"} size="icon-sm" aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor /></Button><Button variant={device === "mobile" ? "outline" : "ghost"} size="icon-sm" aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone /></Button></div><Button variant="outline" size="sm" aria-label="Edit email template" disabled={disabled} onClick={() => setTemplatePage("current")}>Edit</Button></> : <Button variant="outline" size="sm" disabled={disabled} onClick={() => setTemplatePage("library")}>{templateName ? "Change template" : "Select template"}</Button>}<DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="Template options" disabled={disabled}><MoreVertical /></Button>} /><DropdownMenuContent align="end">{saved ? <DropdownMenuItem onClick={() => setTemplatePage("library")}>Select another template</DropdownMenuItem> : null}<DropdownMenuItem onClick={() => setTemplatePage("text")}>Create text only email</DropdownMenuItem><DropdownMenuItem onClick={() => setTemplatePage("html")}>Create custom HTML email</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>{saved && templateName ? <><Suspense fallback={<p role="status">Loading template preview…</p>}><SavedPreview config={draft} device={device} /></Suspense><p className="wf-email-preview-note"><Info />Dynamic content may not appear completely in previews.</p></> : templateName ? <button className="wf-email-selected-template" disabled={disabled} onClick={() => setTemplatePage("current")}><Mail /><span>{templateName}</span><span>Edit</span></button> : null}</section>
      {!saved ? <section className="wf-email-section"><h3>Transactional</h3><label className="wf-email-option"><Checkbox checked={false} disabled aria-label="Apply for transactional status" /><span>Apply for transactional status.<small>Transactional status is unavailable for workflow emails.</small></span></label></section> : null}
      <section className="wf-email-section wf-email-settings"><h3>Settings</h3><label className="wf-email-option"><Checkbox aria-label="Skip recently emailed profiles" checked={Number(draft.smartSendingHours) > 0} disabled={disabled} onCheckedChange={value => set("smartSendingHours", value === true ? 16 : 0)} /><span>Skip recently emailed profiles<small><span className="wf-email-link">Smart Sending</span> will skip anyone who received an email from this workflow’s owner within the last {Number(draft.smartSendingHours) || 16} hours.</small></span></label>{Number(draft.smartSendingHours) > 0 ? <label className="wf-email-window">Smart Sending window (hours)<Input type="number" min={1} max={720} value={Number(draft.smartSendingHours)} disabled={disabled} onChange={event => set("smartSendingHours", Number(event.target.value))} /></label> : null}
        {option("utmTracking", draft.utmTracking !== false, "Enable UTM tracking", <>Links will include additional tracking information, called <span className="wf-email-link">UTM parameters</span>. This allows source tracking within third-party reporting tools such as Google Analytics.</>)}
        {draft.utmTracking !== false ? <><label className="wf-email-option"><Checkbox aria-label="Use custom tracking parameters" checked={draft.useCustomUtm === true} disabled={disabled} onCheckedChange={value => { if (!disabled) setDraft(current => ({ ...current, useCustomUtm: value === true, ...(value === true && !current.utmParameters ? { utmParameters: { utm_source: "filazoo", utm_medium: "email", utm_campaign: String(current.emailName || defaultName) } } : {}) })); }} /><span>Use custom tracking parameters<small>When enabled, this email will use custom tracking parameters instead of the default tracking parameters.</small></span></label>{draft.useCustomUtm ? <div className="wf-email-custom-utm">{flowUtmKeys.map(key => <label className="wf-email-field" key={key}>{key}<Input value={String(draft.utmParameters && typeof draft.utmParameters === "object" && !Array.isArray(draft.utmParameters) ? draft.utmParameters[key] || "" : "")} maxLength={200} disabled={disabled} onChange={event => set("utmParameters", { ...(draft.utmParameters && typeof draft.utmParameters === "object" && !Array.isArray(draft.utmParameters) ? draft.utmParameters : {}), [key]: event.target.value })} /></label>)}</div> : null}</> : null}
        <div className="wf-email-filters"><h3>Additional filters</h3><p>Add additional filters to this email to further restrict who will receive it.</p>{draft.filters && typeof draft.filters === "object" && !Array.isArray(draft.filters) ? <><FlowConditionEditor config={draft.filters} onChange={filters => set("filters", filters)} disabled={disabled} /><Button variant="outline" size="sm" disabled={disabled} onClick={() => { const next = { ...draft }; delete next.filters; setDraft(next); }}>Remove filter</Button></> : <Button className="wf-email-add-filter" size="sm" disabled={disabled} onClick={() => set("filters", { field: "customer_replied", negate: true })}>Add filter</Button>}</div>
        <details className="wf-email-advanced"><summary>Additional sending settings</summary>{option("replyInThread", draft.replyInThread !== false, "Reply in same thread")}{option("trackOpens", draft.trackOpens !== false, "Track opens")}{option("trackClicks", draft.trackClicks !== false, "Track link clicks")}{option("stopOnReply", draft.stopOnReply !== false, "Stop if customer replies")}<label className="wf-email-field">Send window<select value={String(draft.sendWindow || "business_hours")} disabled={disabled} onChange={event => set("sendWindow", event.target.value)}><option value="business_hours">Business hours (09:00–17:00 UTC)</option><option value="anytime">Any time</option></select></label></details>
        <Button variant="outline" size="sm" onClick={() => { if (!changed) onPreview(); else { const result = prepare(); if (result.ok) { onChange(result.config); onPreview(); } } }}>Preview &amp; test message</Button>
      </section>
      {validationError || error ? <p role="alert" className="wf-save-error">{validationError || error}</p> : null}
    </div>
    {footer}
    {templatePage ? <Suspense fallback={<div className="wf-email-template-loading" role="status">Loading email templates…</div>}><TemplatePage config={{ ...pendingConfig, emailName: String(draft.emailName || defaultName) }} onSaveText={onSaveText} mode={templatePage} sessionKey={sessionKey} disabled={disabled} onApply={next => { if (!disabled) { setDraft(next); setValidationError(""); setTemplatePage(null); } }} onClose={() => setTemplatePage(null)} /></Suspense> : null}
  </aside>;
}
