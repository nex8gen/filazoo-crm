"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { ArrowUpRight, CalendarClock, CalendarX2, CreditCard, FileText, History, Mail, MessageSquare, Package, Paperclip, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Link2, LockKeyhole, Smile } from "lucide-react";
import { addCompanyComment, type CrmActionState } from "@/app/crm-actions";
import type { CompanyActivity } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import "./company-timeline.css";

const timeZone = "Asia/Shanghai";
const dayFormatter = new Intl.DateTimeFormat("en", { timeZone, month: "long", day: "numeric", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" });
const exactFormatter = new Intl.DateTimeFormat("en", { timeZone, dateStyle: "full", timeStyle: "long" });
const markerFormatter = new Intl.DateTimeFormat("en-GB", { timeZone, month: "short", day: "numeric" });
const detailFormatter = new Intl.DateTimeFormat("en", { timeZone, dateStyle: "medium", timeStyle: "short" });

function ActivityFields({ fields }: { fields: NonNullable<CompanyActivity["metadata"]> }) {
  return <dl className="company-activity-fields">{fields.map((field, index) => {
    const date = /^\d{4}-\d{2}-\d{2}T/.test(field.value) ? Date.parse(field.value) : NaN;
    const value = Number.isFinite(date) ? detailFormatter.format(new Date(date)) : field.value;
    return <div key={`${field.label}-${index}`} className={/subject|summary|description/i.test(field.label) ? "company-activity-field-wide" : undefined}>
      <dt>{field.label}</dt><dd>{value}</dd>
    </div>;
  })}</dl>;
}

function EmailCopy({ item }: { item: CompanyActivity }) {
  const isHtml = /<(?:html|body|div|p|table|br|a|span|ul|ol|pre|blockquote|h[1-6])\b/i.test(item.body || "");
  const metadata = item.metadata ?? [];
  const attachments = metadata.filter(field => /^attachment$/i.test(field.label));
  const technical = metadata.filter(field => /^(?:message|thread) id$/i.test(field.label));
  const fields = metadata.filter(field => !/^attachment$|^(?:message|thread) id$/i.test(field.label));
  const labels = ["From", "To", "Cc", "Bcc", "Subject", "Status"];
  const ordered = [...labels.flatMap(label => fields.filter(field => field.label.toLowerCase() === label.toLowerCase())), ...fields.filter(field => !labels.some(label => label.toLowerCase() === field.label.toLowerCase())), { label: "Recorded", value: detailFormatter.format(new Date(item.createdAt)) }];
  return <div className="company-activity-expanded company-activity-email-copy">
    <ActivityFields fields={ordered} />
    {attachments.length > 0 && <details className="company-activity-attachments group/attachments">
      <summary><Paperclip aria-hidden="true" />{attachments.length} {attachments.length === 1 ? "attachment" : "attachments"}<ChevronDown aria-hidden="true" className="group-open/attachments:rotate-180" /></summary>
      <ul>{attachments.map((field, index) => <li key={index} title={field.value}><FileText aria-hidden="true" /><span>{field.value}</span></li>)}</ul>
    </details>}
    <div className="company-activity-message">
      <h5>Message</h5>
      {item.body ? isHtml ? <iframe title={`Email copy: ${item.detail}`} sandbox="" referrerPolicy="no-referrer" className="company-activity-email-frame" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light}body{margin:0;font:13px/1.65 system-ui,sans-serif;overflow-wrap:anywhere;padding:4px 0 12px;color:#202223}p{margin:0 0 12px}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{margin:12px 0;padding:8px 12px;background:#f7f8fa;border:0}a{color:#2563eb}</style></head><body>${item.body}</body></html>`} /> : <div className="company-activity-message-text" tabIndex={0} role="region" aria-label="Email message">{item.body}</div> : <p className="company-activity-message-empty">The email body was not saved in this record.</p>}
    </div>
    {technical.length > 0 && <details className="company-activity-technical"><summary>Message details<ChevronDown aria-hidden="true" /></summary><ActivityFields fields={technical} /></details>}
  </div>;
}

function TimelineEntry({ item }: { item: CompanyActivity }) {
  const email = item.type === "email";
  const comment = item.title === "staff comment";
  const expandable = email || Boolean(item.metadata?.length || item.body || item.href);
  const followup = /follow.?up/i.test(item.title);
  const kind = comment ? "note" : followup ? "followup" : item.type;
  const presentation = {
    email: { icon: Mail, label: "Email" },
    note: { icon: MessageSquare, label: "Internal note" },
    followup: { icon: /cancel/i.test(item.title) ? CalendarX2 : CalendarClock, label: "Follow-up" },
    payment: { icon: CreditCard, label: "Payment" },
    invoice: { icon: FileText, label: "Invoice" },
    catalog: { icon: Package, label: "Catalog" },
    event: { icon: Sparkles, label: "Update" },
  }[kind];
  const Icon = presentation.icon;
  const title = comment ? "Internal note added" : item.title.replaceAll("_", " ").replace(/followup/gi, "follow-up").replace(/^./, value => value.toUpperCase());
  const subject = item.metadata?.find((field) => field.label === "Subject")?.value || item.detail;
  const address = item.metadata?.find((field) => field.label === (item.direction === "received" ? "From" : "To"))?.value;
  const recordedTime = <time className="company-activity-time" dateTime={item.createdAt} title={exactFormatter.format(new Date(item.createdAt))}>{timeFormatter.format(new Date(item.createdAt))}</time>;
  return <li className="company-activity-entry" data-kind={kind}>
    <div className="company-activity-rail" aria-hidden="true">
      <span className="company-activity-icon"><Icon /></span>
      <span className="company-activity-date">{markerFormatter.format(new Date(item.createdAt))}</span>
    </div>
    <article className="company-activity-card" aria-label={title}>
      {item.href && <Link href={item.href} className="company-activity-open" aria-label={`Open related record: ${title}`} title="Open related record"><ArrowUpRight aria-hidden="true" /></Link>}
      <div className="company-activity-main">
        <div className="company-activity-copy">
          <h4 className="company-activity-title">{title}</h4>
          <p className={`company-activity-description ${comment ? "whitespace-pre-wrap" : ""}`}>{email ? subject : item.detail}</p>
        </div>
        <div className={`company-activity-person ${item.href ? "company-activity-person-with-link" : ""}`}>
          <div className="company-activity-owner">
            <Avatar className="size-5 shrink-0">
              {item.actorAvatarUrl && <AvatarImage src={item.actorAvatarUrl} alt="" />}
              <AvatarFallback className="bg-brand-soft text-[9px] font-medium text-primary" aria-hidden="true">{item.actor.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase()}</AvatarFallback>
            </Avatar>
            <span>{item.actor}</span>
          </div>
          <span className="company-activity-badge">{presentation.label}</span>
        </div>
      </div>
      {expandable ? <details className="company-activity-details group">
        <summary className="company-activity-summary">
          <span className="company-activity-summary-controls"><span className="company-activity-summary-action">{email ? "View email" : item.type === "payment" ? "Payment details" : item.type === "invoice" ? "Invoice details" : "View details"}<ChevronDown aria-hidden="true" className="size-3 transition-transform group-open:rotate-180" /></span>{email && address && <span className="company-activity-address" title={address}>{item.direction === "received" ? "From" : "To"} {address}</span>}</span>
          {recordedTime}
        </summary>
        {email ? <EmailCopy item={item} /> : <div className="company-activity-expanded">
          <ActivityFields fields={[...(item.metadata ?? []), { label: "Recorded by", value: item.actor }, { label: "Recorded at", value: detailFormatter.format(new Date(item.createdAt)) }]} />
          {item.body && <div className="company-activity-message"><h5>Details</h5><p className="company-activity-message-text">{item.body}</p></div>}
          {item.href && <Link className="company-activity-record-link" href={item.href}>Open related record<ArrowUpRight aria-hidden="true" /></Link>}
        </div>}
      </details> : <div className="company-activity-footer">{recordedTime}</div>}
    </article>
  </li>;
}

export function CompanyTimeline({ companyId, activity, canWrite, viewerName }: { companyId: string; activity: CompanyActivity[]; canWrite: boolean; viewerName: string }) {
  const [comment, setComment] = useState("");
  const [state, action, pending] = useActionState<CrmActionState, FormData>(async (previous, formData) => {
    const result = await addCompanyComment(companyId, previous, formData);
    if (result?.success) setComment("");
    return result;
  }, undefined);
  const [visibleCount, setVisibleCount] = useState(50);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [now] = useState(() => new Date());
  const today = dayFormatter.format(now);
  const yesterday = dayFormatter.format(new Date(now.getTime() - 86_400_000));
  const groups = new Map<string, CompanyActivity[]>();
  for (const item of activity.slice(0, visibleCount)) {
    const day = dayFormatter.format(new Date(item.createdAt));
    groups.set(day, [...(groups.get(day) || []), item]);
  }
  function insert(value: string) {
    const field = textarea.current;
    const start = field?.selectionStart ?? comment.length;
    const end = field?.selectionEnd ?? start;
    setComment(comment.slice(0, start) + value + comment.slice(end));
    field?.focus();
  }
  const initials = viewerName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <section aria-labelledby="customer-timeline-title" data-empty={activity.length === 0} className="company-timeline w-full min-w-0 text-foreground">
    <div className="mb-5"><div className="flex items-center gap-2.5"><h2 id="customer-timeline-title" className="text-lg font-semibold tracking-tight">Activity logs</h2><span className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{activity.length}</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">Conversations, updates, and payments in one place.</p></div>
    {canWrite && <form action={action} className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-primary/15">
      <div className="flex items-start gap-3 p-4"><span title={viewerName} className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-primary">{initials}</span><textarea ref={textarea} name="comment" aria-label="Leave a comment" placeholder="Write an internal note…" maxLength={5000} value={comment} onChange={(event) => setComment(event.target.value)} disabled={pending} className="min-h-16 w-full resize-y bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground/80" /></div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-muted/15 px-3 py-2"><div className="flex items-center gap-1 text-muted-foreground">{[{ icon: Smile, label: "Insert emoji", value: "🙂" }, { icon: Link2, label: "Insert link", value: "https://" }].map(({ icon: Icon, label, value }) => <button type="button" key={label} aria-label={label} title={label} onClick={() => insert(value)} disabled={pending} className="grid size-8 place-items-center rounded-md outline-offset-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2"><Icon className="size-4" /></button>)}<span className="ml-2 hidden items-center gap-1.5 text-xs sm:inline-flex"><LockKeyhole className="size-3" />Team only</span></div><button type="submit" disabled={pending || !comment.trim()} className="inline-flex h-8 items-center gap-2 rounded-lg bg-action px-3 text-xs font-medium text-action-foreground transition-colors hover:bg-action-hover disabled:bg-muted disabled:text-muted-foreground">{pending ? "Posting…" : "Post note"}<ArrowUp className="size-3.5" /></button></div>
    </form>}
    {state?.error && <NotificationToast>{state.error}</NotificationToast>}
    {state?.success && <NotificationToast tone="success">{state.success}</NotificationToast>}
    <div className="company-timeline-events pt-8">
      {[...groups].map(([day, items]) => <div key={day} className="company-activity-group"><div className="company-activity-day-heading"><h3>{day === today ? "Today" : day === yesterday ? "Yesterday" : day}</h3><span aria-hidden="true" /></div><ol className="company-activity-list">{items.map((item) => <TimelineEntry key={item.id} item={item} />)}</ol></div>)}
      {!activity.length && <EmptyState compact className="company-timeline-empty" icon={History} title="No activity yet" description="Updates will appear here." />}
    </div>
    {activity.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 50)} className="mt-6 w-full rounded-lg border py-2.5 text-xs font-medium transition-colors hover:bg-muted">Load older activity</button>}
    <p className="mt-6 text-xs text-muted-foreground/80">Times shown in China Standard Time · UTC+8</p>
  </section>;
}
