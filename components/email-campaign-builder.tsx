"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Mail, MessageCircle, Plus, RefreshCw, Settings2, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampaignAudienceSelect } from "@/components/campaign-audience-select";
import { CampaignTemplateLibrary } from "@/components/campaign-template-library";
import { emailDesignText, renderEmailDesign } from "@/lib/email-design";
import type { Product as MarketingProduct } from "@/lib/types";
import { campaignConfigSchema, campaignLocalDate, campaignMessageIssues, type CampaignAudiencePreview, type CampaignConfig, type CampaignDeliverySummary, type CampaignOptions } from "@/lib/email-campaigns";
import { marketingAssetInputSchema, type MarketingAsset } from "@/lib/marketing-assets";
import type { LibraryDocument } from "@/lib/documents";
import "./email-campaign-builder.css";

type Step = "setup" | "recipients" | "message" | "review";
const steps = ["recipients", "message", "review"] as const;

async function campaignRequest(body: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch("/api/email/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to update this campaign.");
  return result;
}

function initialDraft(asset: MarketingAsset): MarketingAsset {
  if (asset.updatedAt) return { ...asset, campaignConfig: campaignConfigSchema.parse(asset.campaignConfig ?? {}) };
  const today = campaignLocalDate();
  const date = Number(today.slice(0, 4)) === asset.year ? today : `${asset.year}-01-01`;
  const name = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date());
  return { ...asset, title: `Campaign ${name}`, startDate: date, endDate: date, campaignConfig: campaignConfigSchema.parse({}) };
}

function Toggle({ checked, onChange, children, disabled }: { checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode; disabled?: boolean }) {
  return <label className="campaign-builder-toggle"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>{children}</span></label>;
}

export function EmailCampaignBuilder({ initial, canWrite, products = [], onSaved, onDeleted, onClose }: { initial: MarketingAsset; products?: MarketingProduct[]; canWrite: boolean; onSaved: (asset: MarketingAsset) => void; onDeleted: (id: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(() => initialDraft(initial));
  const [saved, setSaved] = useState(() => draft);
  const [tagText, setTagText] = useState(() => draft.campaignConfig!.tags.join(", "));
  const [step, setStep] = useState<Step>(initial.updatedAt ? initial.dispatch ? "review" : "recipients" : "setup");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [options, setOptions] = useState<CampaignOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<"discard" | "send" | "delete" | null>(null);
  const [messageView, setMessageView] = useState<"templates" | "edit">("templates");
  const [showExclusions, setShowExclusions] = useState(Boolean(draft.campaignConfig?.excludeSegments.length));
  const [audience, setAudience] = useState<{ key: string; result?: CampaignAudiencePreview; error?: string } | null>(null);
  const [delivery, setDelivery] = useState<CampaignDeliverySummary | null>(null);
  const [reviewTime, setReviewTime] = useState(() => Date.now());
  const config = draft.campaignConfig!;
  const locked = !canWrite || busy || Boolean(draft.dispatch);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const audienceKey = JSON.stringify({ includeSegments: config.includeSegments, excludeSegments: config.excludeSegments, smartSending: config.smartSending });
  const preview = audience?.key === audienceKey ? audience : null;
  const audienceLoading = !preview && !draft.dispatch;
  const mailbox = options?.mailboxes.find(item => item.id === config.mailboxId);
  const messageIssues = campaignMessageIssues(config, draft.message, mailbox);
  const changeConfig = (value: Partial<CampaignConfig>) => { setDraft(current => ({ ...current, campaignConfig: { ...current.campaignConfig!, ...value } })); setError(""); };
  const changeDraft = (value: Partial<MarketingAsset>) => { setDraft(current => ({ ...current, ...value })); setError(""); };

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/email/campaigns", { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load campaign settings.");
        if (!controller.signal.aborted) { setOptions(result); setOptionsError(""); }
      } catch (cause) { if (!controller.signal.aborted) setOptionsError(cause instanceof Error ? cause.message : "Unable to load campaign settings."); }
    })();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (step === "setup" || draft.dispatch) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void campaignRequest({ action: "preview", config: JSON.parse(audienceKey) }, controller.signal).then(result => {
        if (!controller.signal.aborted) setAudience({ key: audienceKey, result });
      }).catch(cause => { if (!controller.signal.aborted) setAudience({ key: audienceKey, error: cause instanceof Error ? cause.message : "Unable to estimate recipients." }); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [audienceKey, step, revision, draft.dispatch]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!draft.dispatch) return;
    const controller = new AbortController();
    void campaignRequest({ action: "delivery", id: draft.id }, controller.signal).then(result => { if (!controller.signal.aborted) setDelivery(result); }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load delivery status."); });
    return () => controller.abort();
  }, [draft.id, draft.dispatch, revision]);

  async function saveDraft() {
    if (!canWrite || draft.dispatch) return draft;
    const parsed = marketingAssetInputSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the campaign settings."); return null; }
    if (!dirty && saved.updatedAt) return saved;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/marketing-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the campaign.");
      setDraft(result.asset); setSaved(result.asset); onSaved(result.asset);
      return result.asset as MarketingAsset;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the campaign."); return null; }
    finally { setBusy(false); }
  }

  async function next() {
    if (canWrite && step === "recipients" && (!config.includeSegments.length || preview?.error)) { setError(preview?.error || "Choose a list or segment."); return; }
    if (canWrite && step === "message" && messageIssues.length) { setError(messageIssues[0]); return; }
    const result = await saveDraft();
    if (!result) return;
    setReviewTime(Date.now());
    setStep(step === "setup" ? "recipients" : step === "recipients" ? "message" : "review");
  }

  async function submit() {
    setConfirmation(null);
    const asset = await saveDraft();
    if (!asset?.updatedAt) return;
    setBusy(true); setError("");
    try {
      const result = await campaignRequest({ action: "queue", id: asset.id, year: asset.year, updatedAt: asset.updatedAt });
      setDraft(result.asset); setSaved(result.asset); onSaved(result.asset);
      toast.success(config.sendMode === "scheduled" ? "Campaign scheduled" : "Campaign queued for sending");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit the campaign."); }
    finally { setBusy(false); }
  }

  async function deleteDraft() {
    if (!canWrite || !saved.updatedAt || saved.dispatch) return;
    setBusy(true); setError(""); setConfirmation(null);
    try {
      const response = await fetch("/api/marketing-assets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: saved.id, updatedAt: saved.updatedAt }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete this draft.");
      onDeleted(saved.id); toast.success("Campaign draft deleted"); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete this draft."); }
    finally { setBusy(false); }
  }

  function requestClose() { if (busy) return; if (dirty) setConfirmation("discard"); else onClose(); }
  function chooseTemplate(template: LibraryDocument) { changeDraft({ message: template.body, campaignConfig: { ...config, templateId: template.id, emailDesign: template.email_design ?? undefined, subject: config.subject || template.subject } }); }
  const reviewIssues = [...messageIssues, ...(preview?.result?.count ? [] : [preview?.error || "Choose an audience with eligible recipients."]), ...(options?.sendingEnabled ? [] : ["Live email sending is disabled. You can still save a draft."]), ...(config.sendMode === "scheduled" && (!config.scheduledAt || Date.parse(config.scheduledAt) < reviewTime + 60_000 || Date.parse(config.scheduledAt) > reviewTime + 365 * 86400_000) ? ["Choose a send time between one minute and one year from now."] : [])];
  const setupForm = <div className="campaign-builder-setupFields"><label className="campaign-builder-field">Campaign name<span className="sr-only">required</span><Input required maxLength={160} value={draft.title} disabled={locked} onChange={event => changeDraft({ title: event.target.value })} /></label><fieldset className="campaign-builder-field"><legend>Campaign type</legend><div className="campaign-builder-choices"><label data-selected="true"><input type="radio" name="campaign-type" checked readOnly /><span><strong>Single channel</strong><small>One email to your selected audience</small></span><Check /></label><label className="is-unavailable"><input type="radio" name="campaign-type" disabled /><span><strong>Omnichannel</strong><small>Not available for campaigns yet</small></span></label></div></fieldset><label className="campaign-builder-field">Date<Input type="date" required value={draft.startDate} min={`${draft.year}-01-01`} max={`${draft.year}-12-31`} disabled={locked} onChange={event => changeDraft({ startDate: event.target.value, endDate: event.target.value })} /></label><fieldset className="campaign-builder-field"><legend>Channel</legend><div className="campaign-builder-choices"><label data-selected="true"><input type="radio" name="campaign-channel" checked readOnly /><Mail /><span><strong>Email</strong></span><Check /></label><label className="is-unavailable"><input type="radio" name="campaign-channel" disabled /><MessageCircle /><span>Text messaging / WhatsApp</span><small>Not available for campaigns</small></label></div></fieldset><label className="campaign-builder-field">Campaign tags<Input placeholder="Add tags, separated by commas" value={tagText} disabled={locked} onChange={event => { setTagText(event.target.value); changeConfig({ tags: [...new Set(event.target.value.split(",").map(tag => tag.trim()).filter(Boolean))] }); }} /></label></div>;

  return <div className={`campaign-builder${step === "setup" ? " is-setup" : ""}`}>
    {step === "setup" ? <Sheet open onOpenChange={open => { if (!open) requestClose(); }}><SheetContent className="!z-[65] !w-full !gap-0 sm:!max-w-[480px]"><SheetHeader className="border-b px-6 py-5 pr-14"><SheetTitle>Create campaign</SheetTitle><SheetDescription className="sr-only">Set the campaign name, date, channel, and tags.</SheetDescription></SheetHeader><form className="campaign-builder-setupForm" onSubmit={event => { event.preventDefault(); void next(); }}><div className="campaign-builder-setupBody">{setupForm}{error ? <p className="campaign-builder-error" role="alert">{error}</p> : null}</div><div className="campaign-builder-setupFooter"><Button type="submit" disabled={locked}>{busy ? <Loader2 className="animate-spin" /> : null}Continue<ArrowRight /></Button></div></form></SheetContent></Sheet> : <>
      <header className="campaign-builder-header"><div className="campaign-builder-name"><Button variant="ghost" size="icon-sm" aria-label="Back to campaigns" disabled={busy} onClick={requestClose}><ArrowLeft /></Button><span>Campaigns</span><span className="text-muted-foreground">/</span><strong>{draft.title}</strong>{saved.updatedAt && !dirty ? <Check className="text-primary" aria-label="Saved" /> : null}</div><nav className="campaign-builder-steps" aria-label="Campaign steps">{steps.map((item, index) => <button type="button" key={item} aria-current={step === item ? "step" : undefined} data-complete={steps.indexOf(step as typeof steps[number]) > index} disabled={busy || (canWrite && index > steps.indexOf(step as typeof steps[number]) && !draft.dispatch)} onClick={() => { setError(""); setStep(item); }}><span>{index + 1}</span>{item === "recipients" ? "Recipients" : item === "message" ? "Message" : "Review"}</button>)}</nav><div className="campaign-builder-actions"><Button variant="ghost" size="icon-sm" aria-label="Campaign settings" onClick={() => setSettingsOpen(true)}><Settings2 /></Button>{!draft.dispatch && canWrite ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void saveDraft().then(result => { if (result) toast.success("Campaign draft saved"); })}>Save draft</Button> : null}{step !== "recipients" ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { setError(""); setStep(step === "review" ? "message" : "recipients"); }}>Back</Button> : null}{step !== "review" ? <Button size="sm" disabled={busy || (step === "recipients" && audienceLoading)} onClick={() => void next()}>Next<ArrowRight /></Button> : null}</div></header>
      {error || optionsError ? <div className="campaign-builder-banner" role="alert"><AlertCircle /><span>{error || optionsError}</span>{optionsError ? <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Try again</Button> : null}</div> : null}
      <div className={`campaign-builder-body is-${step}`}>
        {step === "recipients" ? <div className="campaign-builder-recipientLayout"><div className="campaign-builder-panelStack"><section className="campaign-builder-panel"><h2>Audience</h2><CampaignAudienceSelect contacts={options?.contacts ?? []} onRefresh={() => setRevision(value => value + 1)} label="Send to" options={options?.audiences ?? []} value={config.includeSegments} onChange={value => changeConfig({ includeSegments: value })} disabled={locked || !options} />{showExclusions ? <CampaignAudienceSelect contacts={options?.contacts ?? []} onRefresh={() => setRevision(value => value + 1)} label="Don't send to" options={(options?.audiences ?? []).filter(item => item.id !== "all")} value={config.excludeSegments} onChange={value => changeConfig({ excludeSegments: value })} disabled={locked || !options} /> : <Button variant="ghost" size="sm" disabled={locked} className="self-start" onClick={() => setShowExclusions(true)}><Plus />Don&apos;t send to</Button>}<div><Toggle disabled={locked} checked={config.smartSending} onChange={smartSending => changeConfig({ smartSending })}>Smart sending</Toggle><p className="campaign-builder-hint">Skip recipients emailed by you in the past 16 hours.</p></div></section><section className="campaign-builder-panel"><h2>Tracking</h2><Toggle disabled={locked} checked={config.utmTracking} onChange={utmTracking => changeConfig({ utmTracking })}>Include tracking parameters</Toggle><p className="campaign-builder-hint">Add UTM parameters to links for campaign reporting.</p></section>{preview?.result?.recipients.length ? <section className="campaign-builder-panel"><h2>Recipient preview</h2><div className="campaign-builder-recipientList">{preview.result.recipients.map(recipient => <div key={recipient.id}><span>{recipient.name || recipient.email}<small>{recipient.companyName}</small></span><span>{recipient.email}</span></div>)}</div>{preview.result.count > 10 ? <p className="campaign-builder-hint">Showing 10 of {preview.result.count} recipients</p> : null}</section> : null}</div><aside className="campaign-builder-estimate" aria-live="polite"><strong>{audienceLoading ? <Loader2 className="animate-spin" /> : preview?.error ? "—" : preview?.result?.count ?? draft.dispatch?.recipientCount ?? 0}</strong><span>Estimated recipients</span><p>Form submissions, Meta leads, and verified contacts are eligible. Unsubscribed and suppressed contacts are excluded.</p>{preview?.result?.selected !== undefined ? <small>{preview.result.selected} selected contacts · {preview.result.unverified ?? 0} need review</small> : null}{preview?.result?.recent ? <small>{preview.result.recent} skipped by smart sending</small> : null}{preview?.error ? <div><p role="alert">{preview.error}</p><Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw />Try again</Button></div> : null}</aside></div> : null}
        {step === "message" ? <div className="campaign-builder-messageLayout"><section className="campaign-builder-panel campaign-builder-messageFields"><h2><Mail />Email message</h2><label className="campaign-builder-field">Subject line<Input required maxLength={300} value={config.subject} disabled={locked} onChange={event => changeConfig({ subject: event.target.value })} /></label><label className="campaign-builder-field">Preview text<Input maxLength={300} value={config.preheader} disabled={locked} onChange={event => changeConfig({ preheader: event.target.value })} /></label><label className="campaign-builder-field">Sender name<Input maxLength={160} value={config.senderName} disabled={locked} onChange={event => changeConfig({ senderName: event.target.value })} placeholder="Filazoo" /></label><label className="campaign-builder-field">Sender email<select className="campaign-builder-select" value={config.mailboxId} disabled={locked || !options} onChange={event => changeConfig({ mailboxId: event.target.value })}><option value="">Select sender account</option>{options?.mailboxes.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.email}{!item.available ? " (not connected)" : ""}</option>)}</select></label><Toggle checked={config.useSenderReplyTo} disabled={locked} onChange={useSenderReplyTo => changeConfig({ useSenderReplyTo })}>Use sender email as reply-to</Toggle>{!config.useSenderReplyTo ? <label className="campaign-builder-field">Reply-to email<Input type="email" value={config.replyTo} disabled={locked} onChange={event => changeConfig({ replyTo: event.target.value })} /></label> : null}</section><section className="campaign-builder-panel campaign-builder-messageContent"><div className="campaign-builder-contentTabs" role="group" aria-label="Message content"><Button size="sm" variant={messageView === "templates" ? "secondary" : "ghost"} onClick={() => setMessageView("templates")}>Saved templates</Button><Button size="sm" variant={messageView === "edit" ? "secondary" : "ghost"} onClick={() => setMessageView("edit")}>Write message</Button></div>{messageView === "templates" ? <CampaignTemplateLibrary design={config.emailDesign} body={draft.message} name={draft.title} subject={config.subject} products={products} onDesignApply={(design, template) => changeDraft({ message: emailDesignText(design), campaignConfig: { ...config, emailDesign: design, templateId: template?.id ?? null } })} selectedId={config.templateId} onSelect={template => { if (!locked) chooseTemplate(template); }} canWrite={!locked} /> : <div className="campaign-builder-compose"><label htmlFor="campaign-message-body">Email body</label><Textarea id="campaign-message-body" disabled={locked} maxLength={12000} value={draft.message} onChange={event => changeDraft({ message: event.target.value, campaignConfig: { ...config, emailDesign: undefined, templateId: null } })} placeholder="Write your email message" /><p className="campaign-builder-hint">{"Personalize with {{first_name}}, {{name}}, {{company}}, or {{email}}."}</p></div>}{draft.message ? <div className="campaign-builder-emailPreview"><span>Message preview</span><strong>{config.subject || "Subject line"}</strong>{config.preheader ? <small>{config.preheader}</small> : null}{config.emailDesign ? <iframe className="campaign-builder-designPreview" title="Campaign email preview" sandbox="" srcDoc={renderEmailDesign(config.emailDesign).html} /> : <p>{draft.message}</p>}</div> : null}</section></div> : null}
        {step === "review" ? <div className="campaign-builder-reviewLayout"><aside className="campaign-builder-reviewSidebar"><h2>{draft.dispatch ? "Delivery" : "Review"}</h2>{draft.dispatch ? <><div className="campaign-builder-success"><Check /><span>{config.sendMode === "scheduled" ? "Campaign scheduled" : "Campaign queued"}</span></div><p className="campaign-builder-hint">{draft.dispatch.recipientCount} recipients · {new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(draft.dispatch.scheduledAt))} (Asia/Shanghai)</p>{delivery ? <dl className="campaign-builder-deliveryStats">{Object.entries({ Sent: delivery.sent, Scheduled: delivery.scheduled, Processing: delivery.pending, Skipped: delivery.skipped, Failed: delivery.failed }).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl> : <p role="status">Loading delivery status…</p>}<Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw />Refresh status</Button></> : <>{[{ label: "Recipients", done: Boolean(preview?.result?.count), detail: preview?.result ? `${preview.result.count} estimated recipients` : "Choose an audience", target: "recipients" }, { label: "Message", done: !messageIssues.length, detail: messageIssues[0] || "Message complete", target: "message" }, { label: "Tracking", done: true, detail: config.utmTracking ? "UTM parameters enabled" : "UTM parameters off", target: "recipients" }].map(item => <div className="campaign-builder-reviewItem" key={item.label}><div><strong>{item.label}</strong><Button variant="outline" size="xs" onClick={() => setStep(item.target as Step)}>Edit</Button></div><p>{item.done ? <Check className="text-primary" /> : <AlertCircle className="text-amber-600" />}{item.detail}</p>{item.label === "Recipients" && config.smartSending ? <small>Smart sending enabled</small> : null}</div>)}<fieldset className="campaign-builder-sendOptions" disabled={locked}><legend>Delivery time</legend><label><input type="radio" name="campaign-send-mode" checked={config.sendMode === "now"} onChange={() => changeConfig({ sendMode: "now" })} />Send now</label><label><input type="radio" name="campaign-send-mode" checked={config.sendMode === "scheduled"} onChange={() => changeConfig({ sendMode: "scheduled" })} />Schedule for later</label>{config.sendMode === "scheduled" ? <label className="campaign-builder-field">Time (Asia/Shanghai)<Input type="datetime-local" value={config.scheduledAt ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(config.scheduledAt)).replace(" ", "T") : ""} onChange={event => { const date = new Date(`${event.target.value}:00+08:00`); changeConfig({ scheduledAt: Number.isNaN(date.getTime()) ? null : date.toISOString() }); }} /></label> : null}</fieldset>{reviewIssues.length ? <ul className="campaign-builder-reviewIssues">{reviewIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}<Button disabled={locked || audienceLoading || Boolean(reviewIssues.length)} onClick={() => setConfirmation("send")}>{busy ? <Loader2 className="animate-spin" /> : <Mail />}{config.sendMode === "scheduled" ? "Schedule campaign" : "Send campaign"}</Button></>}</aside><div className="campaign-builder-reviewCanvas"><div className="campaign-builder-audienceNode"><Users /><div><strong>Email audience</strong><span>{draft.dispatch?.recipientCount ?? preview?.result?.count ?? 0} recipients</span></div></div><span className="campaign-builder-connector" aria-hidden="true" /><div className="campaign-builder-messageNode"><h3><Mail />Email message</h3><div className="campaign-builder-envelope"><small>{config.senderName || mailbox?.name || "Filazoo"}{" <"}{mailbox?.email || "Sender email"}{">"}</small><strong>{config.subject || "Subject line"}</strong>{config.preheader ? <span>{config.preheader}</span> : null}{config.emailDesign ? <iframe className="campaign-builder-designPreview" title="Review campaign email" sandbox="" srcDoc={renderEmailDesign(config.emailDesign).html} /> : <p>{draft.message || "Your email message will appear here."}</p>}</div></div></div></div> : null}
      </div>
      <footer className="campaign-builder-footer"><span role="status">{busy ? "Saving…" : dirty ? "Unsaved changes" : saved.updatedAt ? "All changes saved" : "New campaign"}</span>{!canWrite ? <span>View only</span> : null}</footer>
    </>}
    <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetContent className="!z-[65] !w-full !gap-0 sm:!max-w-[480px]"><SheetHeader className="border-b px-6 py-5 pr-14"><SheetTitle>Campaign settings</SheetTitle><SheetDescription className="sr-only">Edit the campaign name, date, and tags.</SheetDescription></SheetHeader><form className="campaign-builder-setupForm" onSubmit={event => { event.preventDefault(); void saveDraft().then(result => { if (result) setSettingsOpen(false); }); }}><div className="campaign-builder-setupBody">{setupForm}{error ? <p role="alert" className="campaign-builder-error">{error}</p> : null}</div><div className="campaign-builder-setupFooter">{canWrite && saved.updatedAt && !saved.dispatch ? <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => setConfirmation("delete")}><Trash2 />Delete draft</Button> : null}<Button type="submit" disabled={locked}>Save settings</Button></div></form></SheetContent></Sheet>
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null); }}><DialogContent className="!z-[80]"><DialogHeader><DialogTitle>{confirmation === "delete" ? "Delete this campaign draft?" : confirmation === "send" ? config.sendMode === "scheduled" ? "Schedule this campaign?" : "Send this campaign?" : "Discard unsaved changes?"}</DialogTitle><DialogDescription>{confirmation === "delete" ? "This removes the saved campaign draft from your workspace." : confirmation === "send" ? `${preview?.result?.count ?? 0} recipients will receive this email from ${mailbox?.email || "your selected account"}.` : "Your latest changes have not been saved."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>{confirmation === "send" ? "Keep reviewing" : "Keep editing"}</Button><Button variant={confirmation === "send" ? "default" : "destructive"} onClick={() => { if (confirmation === "send") void submit(); else if (confirmation === "delete") void deleteDraft(); else onClose(); }}>{confirmation === "delete" ? "Delete draft" : confirmation === "send" ? config.sendMode === "scheduled" ? "Schedule campaign" : "Send campaign" : "Discard changes"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
