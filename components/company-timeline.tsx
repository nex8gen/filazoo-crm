"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { AtSign, ChevronDown, Hash, Link2, Smile } from "lucide-react";
import { addCompanyComment, type CrmActionState } from "@/app/crm-actions";
import type { CompanyActivity } from "@/lib/types";

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
  return <li className="relative pb-6 pl-8 last:pb-2">
    <span aria-hidden="true" className="absolute -left-[9px] top-1 grid size-4 place-items-center rounded-[4px] bg-[#dedede] dark:bg-neutral-600"><span className="size-2 rounded-[2px] bg-[#303030] dark:bg-neutral-100" /></span>
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <p className={comment ? "font-medium" : ""}>{comment ? `${item.actor} left a comment` : email ? `${item.title === "Email received" ? "Email received from" : item.title === "Email failed" ? "Email failed to send to" : item.title === "Email sent" ? "Email sent to" : item.title} ${item.metadata?.find((field) => field.label === "To" || field.label === "From")?.value || item.actor}.` : item.title.charAt(0).toUpperCase() + item.title.slice(1)}</p>
        {comment ? <p className="mt-2 whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3">{item.detail}</p> : <p className="mt-0.5 break-words text-muted-foreground">{item.detail}</p>}
      </div>
      <time className="shrink-0 text-xs leading-5 text-muted-foreground sm:text-right" dateTime={item.createdAt} title={exactFormatter.format(new Date(item.createdAt))}>{timeFormatter.format(new Date(item.createdAt))}</time>
    </div>
    {expandable ? <details className="group mt-2">
      <summary className={email ? "inline-flex cursor-pointer list-none items-center rounded-full bg-[#ededed] px-3 py-1 text-xs font-medium text-[#202223] outline-offset-4 hover:bg-[#e3e3e3] focus-visible:outline-2 dark:bg-muted dark:text-foreground [&::-webkit-details-marker]:hidden" : "inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground outline-offset-4 hover:text-foreground focus-visible:outline-2 [&::-webkit-details-marker]:hidden"}>
        {email ? "View email" : item.type === "payment" ? "Payment details" : item.type === "invoice" ? "Invoice details" : "View details"}{!email && <ChevronDown className="size-3 transition-transform group-open:rotate-180" />}
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
  return <section aria-labelledby="customer-timeline-title" className="mx-auto w-full max-w-[800px] px-1 pb-6 text-foreground sm:px-5">
    <h2 id="customer-timeline-title" className="mb-4 text-base font-medium">Timeline</h2>
    {canWrite && <form action={action} className="relative z-10 overflow-hidden rounded-[18px] border bg-background shadow-[0_2px_12px_0_#00000008]">
      <div className="flex items-start gap-3 px-3 py-4"><span title={viewerName} className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold">{initials}</span><textarea ref={textarea} name="comment" aria-label="Leave a comment" placeholder="Leave a comment..." maxLength={5000} value={comment} onChange={(event) => setComment(event.target.value)} disabled={pending} className="min-h-9 w-full resize-y bg-transparent py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground" /></div>
      <div className="flex items-center justify-between bg-[#f7f7f7] px-4 py-3 dark:bg-muted/40"><div className="flex gap-3 text-[#616161] dark:text-muted-foreground">{[{ icon: Smile, label: "Insert emoji", value: "🙂" }, { icon: AtSign, label: "Insert @", value: "@" }, { icon: Hash, label: "Insert #", value: "#" }, { icon: Link2, label: "Insert link", value: "https://" }].map(({ icon: Icon, label, value }) => <button type="button" key={label} aria-label={label} title={label} onClick={() => insert(value)} disabled={pending} className="rounded outline-offset-4 hover:text-foreground focus-visible:outline-2"><Icon className="size-4" /></button>)}</div><button type="submit" disabled={pending || !comment.trim()} className="rounded-full bg-[#303030] px-3 py-1 text-xs font-medium text-white disabled:bg-[#d9d9d9] disabled:text-white dark:disabled:bg-neutral-700">{pending ? "Posting..." : "Post"}</button></div>
    </form>}
    {state?.error && <p role="alert" className="mt-2 text-xs text-destructive">{state.error}</p>}
    {state?.success && <p role="status" className="mt-2 text-xs text-muted-foreground">{state.success}</p>}
    {canWrite && <p className="mt-1.5 text-right text-xs text-muted-foreground">Only you and other staff can see comments</p>}
    <div className="ml-9 border-l-2 border-[#dedede] pb-2 pt-7 dark:border-neutral-700">
      {[...groups].map(([day, items]) => <div key={day}><h3 className="mb-5 pl-8 text-xs text-muted-foreground">{day === today ? "Today" : day === yesterday ? "Yesterday" : day}</h3><ol>{items.map((item) => <TimelineEntry key={item.id} item={item} />)}</ol></div>)}
      {!activity.length && <p className="pl-8 text-sm text-muted-foreground">No activity has been recorded yet.</p>}
    </div>
    {activity.length > visibleCount && <button type="button" onClick={() => setVisibleCount((count) => count + 50)} className="ml-9 mt-5 rounded-full border px-4 py-2 text-xs hover:bg-muted">Show older activity</button>}
    <p className="ml-9 mt-4 text-[11px] text-muted-foreground">All times in China Standard Time (UTC+8).</p>
  </section>;
}
