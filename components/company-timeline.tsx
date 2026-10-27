"use client";

import { History } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Link2, LockKeyhole, Smile } from "lucide-react";
import { addCompanyComment, type CrmActionState } from "@/app/crm-actions";
import type { CompanyActivity } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const timeZone = "Asia/Shanghai";
const dayFormatter = new Intl.DateTimeFormat("en", { timeZone, month: "long", day: "numeric", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" });
const exactFormatter = new Intl.DateTimeFormat("en", { timeZone, dateStyle: "full", timeStyle: "long" });

function EmailCopy({ item }: { item: CompanyActivity }) {
  const isHtml = /<(?:html|body|div|p|table|br|a|span)\b/i.test(item.body || "");
  return <div className="mt-3 overflow-hidden rounded-lg border bg-background">
    <dl className="space-y-1 border-b bg-muted/30 p-4 text-xs">
      {item.metadata?.map((field, index) => <div key={`${field.label}-${index}`} className="flex flex-wrap gap-x-2"><dt className="font-medium">{field.label}:</dt><dd className="min-w-0 break-words [overflow-wrap:anywhere]">{field.value}</dd></div>)}
      <div className="flex flex-wrap gap-x-2"><dt className="font-medium">Recorded:</dt><dd>{exactFormatter.format(new Date(item.createdAt))}</dd></div>
    </dl>
    {item.body ? isHtml ? <iframe title={`Email copy: ${item.detail}`} sandbox="" referrerPolicy="no-referrer" className="h-96 w-full bg-white" srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{font:14px/1.6 system-ui,sans-serif;overflow-wrap:anywhere;padding:16px;color:#202223}img{max-width:100%}table{max-width:100%}</style></head><body>${item.body}</body></html>`} /> : <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 [overflow-wrap:anywhere]">{item.body}</div> : <p className="p-4 text-sm text-muted-foreground">The email body was not saved in this record.</p>}
  </div>;
}

function TimelineEntry({ item }: { item: CompanyActivity }) {
  const email = item.type === "email";
  const comment = item.title === "staff comment";
  const expandable = email || Boolean(item.metadata?.length || item.body || item.href);
  const action = comment ? "left a comment" : ({
    "Email received": "received an email", "Email failed": "couldn’t send an email", "Email sent": "sent an email",
    "Payment recorded": "recorded a payment", "Invoice created": "created an invoice", "Invoice issued": "issued an invoice",
    "Invoice updated": "updated an invoice", "Invoice voided": "voided an invoice",
  } as Record<string, string>)[item.title] || `· ${item.title}`;
  const subject = item.metadata?.find((field) => field.label === "Subject")?.value || item.detail;
  const address = item.metadata?.find((field) => field.label === (item.direction === "received" ? "From" : "To"))?.value;
  return <li className="relative pb-7 pl-12 last:pb-0">
    <Avatar className="absolute left-0 top-0 size-8 ring-4 ring-background">
      {item.actorAvatarUrl && <AvatarImage src={item.actorAvatarUrl} alt="" />}
      <AvatarFallback className="bg-brand-soft text-[11px] font-medium text-primary" aria-hidden="true">{item.actor.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</AvatarFallback>
    </Avatar>
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-1">
      <p className="min-w-0 flex-1 break-words text-[13px] leading-5 [overflow-wrap:anywhere]"><span className="font-semibold">{item.actor}</span>{" "}<span className="text-muted-foreground">{action}</span></p>
      <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground" dateTime={item.createdAt} title={exactFormatter.format(new Date(item.createdAt))}>{timeFormatter.format(new Date(item.createdAt))}</time>
    </div>
    {comment ? <p className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm leading-6 [overflow-wrap:anywhere]">{item.detail}</p> : <div className="mt-2 min-w-0"><p className={`break-words text-[13px] leading-5 [overflow-wrap:anywhere] ${email ? "font-medium" : "text-muted-foreground"}`}>{email ? subject : item.detail}</p>{email && address && <p className="mt-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{item.direction === "received" ? "From" : "To"} {address}</p>}</div>}
    {expandable ? <details className="group mt-2">
      <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground outline-offset-4 transition-colors hover:text-foreground focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
        {email ? "View email" : item.type === "payment" ? "Payment details" : item.type === "invoice" ? "Invoice details" : "View details"}<ChevronDown className="size-3 transition-transform group-open:rotate-180" />
      </summary>
      {email ? <EmailCopy item={item} /> : <div className="mt-3 space-y-3 rounded-lg border bg-muted/20 p-4">
        <dl className="grid gap-3 text-xs sm:grid-cols-2">{item.metadata?.map((field, index) => <div key={`${field.label}-${index}`} className="min-w-0"><dt className="capitalize text-muted-foreground">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{field.value}</dd></div>)}<div><dt className="text-muted-foreground">Recorded by</dt><dd className="mt-1">{item.actor}</dd></div><div><dt className="text-muted-foreground">Recorded at</dt><dd className="mt-1">{exactFormatter.format(new Date(item.createdAt))}</dd></div></dl>
        {item.body && <p className="whitespace-pre-wrap text-sm">{item.body}</p>}
        {item.href && <Link className="inline-block text-xs font-medium underline underline-offset-4" href={item.href}>View invoice</Link>}
      </div>}
    </details> : null}
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
  return <section aria-labelledby="customer-timeline-title" className="mx-auto w-full max-w-3xl px-1 pb-8 text-foreground sm:px-4">
    <div className="mb-5"><h2 id="customer-timeline-title" className="text-base font-semibold tracking-tight">Activity</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Conversations, updates, and payments in one place.</p></div>
    {canWrite && <form action={action} className="overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-primary/15">
      <div className="flex items-start gap-3 p-4"><span title={viewerName} className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-primary">{initials}</span><textarea ref={textarea} name="comment" aria-label="Leave a comment" placeholder="Write an internal note…" maxLength={5000} value={comment} onChange={(event) => setComment(event.target.value)} disabled={pending} className="min-h-16 w-full resize-y bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground/80" /></div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-muted/15 px-3 py-2"><div className="flex items-center gap-1 text-muted-foreground">{[{ icon: Smile, label: "Insert emoji", value: "🙂" }, { icon: Link2, label: "Insert link", value: "https://" }].map(({ icon: Icon, label, value }) => <button type="button" key={label} aria-label={label} title={label} onClick={() => insert(value)} disabled={pending} className="grid size-8 place-items-center rounded-md outline-offset-2 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2"><Icon className="size-4" /></button>)}<span className="ml-2 hidden items-center gap-1.5 text-[11px] sm:inline-flex"><LockKeyhole className="size-3" />Team only</span></div><button type="submit" disabled={pending || !comment.trim()} className="inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground">{pending ? "Posting…" : "Post note"}<ArrowUp className="size-3.5" /></button></div>
    </form>}
    {state?.error && <p role="alert" className="mt-2 text-xs text-destructive">{state.error}</p>}
    {state?.success && <p role="status" className="mt-2 text-xs text-muted-foreground">{state.success}</p>}
    <div className="pt-8">
      {[...groups].map(([day, items]) => <div key={day} className="mb-8 last:mb-0"><div className="mb-5 flex items-center gap-3"><h3 className="shrink-0 text-xs font-medium text-muted-foreground">{day === today ? "Today" : day === yesterday ? "Yesterday" : day}</h3><div aria-hidden="true" className="h-px flex-1 bg-border/60" /></div><ol className="relative before:absolute before:bottom-4 before:left-4 before:top-2 before:w-px before:bg-border/70">{items.map((item) => <TimelineEntry key={item.id} item={item} />)}</ol></div>)}
      {!activity.length && <EmptyState compact icon={History} title="No activity yet" description="Updates will appear here." />}
    </div>
    {activity.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 50)} className="mt-6 w-full rounded-lg border py-2.5 text-xs font-medium transition-colors hover:bg-muted">Load older activity</button>}
    <p className="mt-6 text-[11px] text-muted-foreground/80">Times shown in China Standard Time · UTC+8</p>
  </section>;
}
