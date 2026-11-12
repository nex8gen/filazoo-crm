"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, CheckCircle2, ChevronRight, Clock3, Info, LoaderCircle, Mail, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { followupInstant, followupLocalTime } from "@/lib/company-followup";
import { followupSubject, validateFollowupTime, type EmailFollowup } from "@/lib/email-followup";
import { requestFollowup } from "@/lib/email-followup-request";

const labels: Record<EmailFollowup["status"], string> = {
  scheduled: "Follow-up scheduled", processing: "Sending follow-up…", reminded: "Reminder due",
  sent: "Follow-up sent", cancelled: "Follow-up cancelled", failed: "Follow-up needs attention", uncertain: "Check delivery in Sent",
};
const actionClassName = "group grid w-full min-h-11 grid-cols-[1.75rem_minmax(0,1fr)_0.875rem] items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40";
type Props = {
  mailboxId?: string | null; messageId?: string | null; subject: string; recipient: string;
  anchors?: string[]; baseline?: string[];
  canManage: boolean; aiConfigured: boolean;
  onUpdated: (followup: EmailFollowup | null, mutation?: "save" | "cancel") => void;
};
export function EmailFollowupPanel({ mailboxId, messageId, subject, recipient, canManage, aiConfigured, onUpdated, anchors, baseline: visibleBaseline }: Props) {
  const [followup, setFollowup] = useState<EmailFollowup | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"reminder" | "ai">("reminder");
  const [nurture, setNurture] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [preset, setPreset] = useState("1 hour");
  const [draftSubject, setDraftSubject] = useState("");
  const [body, setBody] = useState("");
  const [baseline, setBaseline] = useState<string[] | undefined>();
  const [reviewBaseline, setReviewBaseline] = useState<string[]>(visibleBaseline || (messageId ? [messageId] : []));
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const pending = useRef(false);
  const version = useRef(0);
  const alive = useRef(true);
  const generation = useRef<AbortController | null>(null);
  const awaitingStatus = useRef(false);
  const updated = useEffectEvent(onUpdated);
  const dialogOpen = useEffectEvent(() => open);
  const currentBaseline = useEffectEvent(() => visibleBaseline || (messageId ? [messageId] : []));
  const query = mailboxId && messageId ? new URLSearchParams({ mailboxId, messageId, anchors: JSON.stringify(anchors || []) }).toString() : "";
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current?.abort(); }; }, []);
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let reading = false;
    async function refresh(initial = false) {
      if (reading || (!initial && (pending.current || dialogOpen() || document.visibilityState === "hidden"))) return;
      reading = true;
      const current = version.current;
      try {
        // Large reply chains belong in the request body, not the URL/header limit.
        const context = Object.fromEntries(new URLSearchParams(query));
        const result = await requestFollowup("/api/email/follow-up", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", ...context, anchors: JSON.parse(context.anchors) }) }, 20_000);
        if (!("followup" in result)) throw new Error("The follow-up response was incomplete. Please retry.");
        if (!controller.signal.aborted && current === version.current) {
          setFollowup(result.followup); setReviewBaseline(currentBaseline()); setLoaded(true); setLoadError(""); updated(result.followup);
          if (awaitingStatus.current) {
            if (result.followup) setRequestId(result.followup.id);
            setDraftRevision(result.followup?.revision ?? 0);
            awaitingStatus.current = false;
          }
        }
      } catch (cause) { if (!controller.signal.aborted && current === version.current) setLoadError(cause instanceof Error ? cause.message : "Unable to load follow-up."); }
      finally { reading = false; }
    }
    void refresh(true);
    const resume = () => void refresh();
    const interval = setInterval(resume, 15_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [query, retry]);

  function chooseTime(value: string) {
    setPreset(value);
    if (value === "Custom") return;
    const date = new Date();
    if (value === "Tomorrow") { date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0); }
    else date.setMinutes(date.getMinutes() + (value === "5 minutes" ? 5 : 60));
    setDueAt(followupLocalTime(date.toISOString()));
  }
  async function generate() {
    if (pending.current) return;
    pending.current = true; setGenerating(true); setError("");
    const controller = new AbortController(); generation.current = controller;
    try {
      const result = await requestFollowup("/api/email/follow-up", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", mailboxId, messageId }) }, 65_000);
      if (alive.current) { setBody(result.body); setDraftSubject(result.subject); setBaseline(result.baseline); }
    } catch (cause) { if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to generate follow-up."); }
    finally { if (generation.current === controller) { generation.current = null; pending.current = false; if (alive.current) setGenerating(false); } }
  }
  function begin(nextKind: "reminder" | "ai", editing = false) {
    setNurture(nextKind === "ai" && followup?.purpose === "nurture");
    setKind(nextKind); setError(""); setNotice(""); setRequestId(followup?.id || crypto.randomUUID());
    awaitingStatus.current = !loaded;
    setDraftRevision(followup?.revision ?? 0);
    setDraftSubject(editing && followup ? followup.subject : followupSubject(subject));
    setBody(editing && followup ? followup.body : ""); setBaseline(visibleBaseline || reviewBaseline);
    if (editing && followup) { setDueAt(followupLocalTime(followup.due_at)); setPreset("Custom"); }
    else chooseTime("1 hour");
    setOpen(true);
    if (nextKind === "ai" && !editing && aiConfigured) void generate();
  }
  async function mutate(action: "save" | "cancel") {
    if (pending.current) return;
    if (action === "save" && (!loaded || loadError || followup?.status === "processing" || followup?.status === "uncertain")) return;
    setError("");
    let instant = "";
    if (action === "save") {
      try { instant = followupInstant(dueAt); validateFollowupTime(instant); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Choose a future time."); return; }
    }
    pending.current = true; version.current++; setBusy(true);
    try {
      const input = action === "cancel" ? { action, id: followup?.id, revision: followup?.revision }
        : { action, id: requestId, revision: draftRevision, mailboxId, messageId, kind, purpose: kind === "ai" && nurture ? "nurture" : "followup", dueAt: instant, subject: draftSubject, body, baseline };
      const result = await requestFollowup("/api/email/follow-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, 90_000);
      if (alive.current) {
        setFollowup(result.followup); onUpdated(result.followup, action); setOpen(false);
        setNotice(action === "cancel" ? "Follow-up cancelled." : kind === "reminder" ? "Reminder saved. You will be notified when it is due." : "AI follow-up scheduled. It will send once if the customer has not replied.");
        window.dispatchEvent(new Event("flow-activity-updated"));
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Unable to save follow-up."); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const active = followup && ["scheduled", "processing", "reminded"].includes(followup.status);
  const locked = busy || generating || !canManage || !query || followup?.status === "processing" || followup?.status === "uncertain";
  return <section className="mx-6 mb-6 space-y-3" aria-label="Follow up on this email">
    {followup ? <div className="rounded-xl border bg-muted/20 p-3.5" aria-live="polite">
      <h3 className="flex items-center gap-2 text-xs font-semibold"><CalendarClock className="size-4 text-muted-foreground" />Follow-up status</h3>
      <p className="mt-3 flex items-center gap-2 text-xs font-semibold"><span className={`size-2 rounded-full ${active ? "bg-blue-500" : followup.status === "sent" ? "bg-emerald-500" : "bg-muted-foreground"}`} />{labels[followup.status]}</p>
      <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground"><Clock3 className="mt-0.5 size-3.5 shrink-0" /><span>{new Date(followup.due_at).toLocaleString()} · {followup.kind === "ai" ? "AI sends once" : "Notify me"}</span></p>
      {active ? <p className="mt-2 flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />Stops when the customer replies</p> : null}
      {followup.error ? <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{followup.error}</p> : null}
      <div className="mt-3 flex justify-end gap-3 text-xs">
        {followup.task_id && followup.kind === "reminder" ? <Link className="mr-auto text-primary hover:underline" href="/tasks">View task</Link> : null}
        {active && followup.status !== "processing" && canManage ? <><button type="button" disabled={locked} onClick={() => begin(followup.kind, true)} className="font-medium text-primary hover:underline disabled:opacity-40">Edit</button><button type="button" disabled={locked} onClick={() => void mutate("cancel")} className="font-medium text-muted-foreground hover:underline disabled:opacity-40">Cancel</button></> : null}
      </div>
    </div> : null}
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-5"><Mail aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />Follow up on this email</h3>
        <Popover>
          <PopoverTrigger aria-label="Follow-up details" title="Follow-up details" className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Info aria-hidden="true" className="size-3.5" /></PopoverTrigger>
          <PopoverContent align="end" className="w-64 max-w-[calc(100vw-2rem)] gap-3 p-3.5 text-xs leading-5">
            <PopoverTitle className="text-xs">Follow-up details</PopoverTitle>
            <p className="text-muted-foreground">Choose how and when to follow up.</p>
            <dl className="grid gap-2"><div><dt className="font-medium">Remind me</dt><dd className="text-muted-foreground">Get a reminder to follow up</dd></div><div><dt className="font-medium">AI follow-up</dt><dd className="text-muted-foreground">Send once if there is no reply</dd></div></dl>
            <p className="border-t pt-2 text-muted-foreground">Only for this email conversation</p>
          </PopoverContent>
        </Popover>
      </div>
      <div className="mt-2.5 grid gap-2">
        <button type="button" disabled={locked} onClick={() => begin("reminder")} className={`${actionClassName} border-border bg-background hover:border-rose-200 hover:bg-rose-50/50 dark:hover:border-rose-500/30 dark:hover:bg-rose-500/5`}>
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"><Bell className="size-4" strokeWidth={1.75} /></span>
          <span className="min-w-0 text-[13px] font-medium leading-5 text-foreground">Remind me</span>
          <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
        </button>
        <button type="button" disabled={locked} onClick={() => begin("ai")} className={`${actionClassName} border-indigo-100 bg-indigo-50/40 hover:border-indigo-200 hover:bg-indigo-50/80 dark:border-indigo-500/20 dark:bg-indigo-500/5 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10`}>
          <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-indigo-100/80 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"><Sparkles className="size-4" strokeWidth={1.75} /></span>
          <span className="min-w-0 text-[13px] font-medium leading-5 text-foreground">AI follow-up</span>
          <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
        </button>
      </div>
      {!query ? <p className="mt-2 text-xs text-muted-foreground">Open a synced mailbox message to schedule a follow-up.</p> : !loaded && !loadError ? <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Loading follow-up…</p> : null}
      {!canManage ? <p className="mt-2 text-xs text-muted-foreground">Read-only users cannot schedule follow-ups.</p> : null}
      {loadError ? <p role="alert" className="mt-2 text-xs text-destructive">{loadError} <button type="button" onClick={() => setRetry(value => value + 1)} className="font-medium underline">Retry</button></p> : null}
    </div>
    {notice ? <p role="status" className="text-xs leading-5 text-primary">{notice}</p> : null}
    {error && !open ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <Dialog open={open} onOpenChange={value => { if (!busy) { if (!value) generation.current?.abort(); setOpen(value); setError(""); } }}>
      <DialogContent className="gap-5 sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader><DialogTitle className="flex items-center gap-2">{kind === "ai" ? <Sparkles className="size-5 text-indigo-600" /> : <Bell className="size-5 text-rose-600" />}{kind === "ai" ? "AI follow-up" : "Remind me"}</DialogTitle><DialogDescription>{kind === "ai" ? "Review the message and choose when to send it." : "Choose a time. We will create a task and notify you."}</DialogDescription></DialogHeader>
        <div className="flex items-center gap-3 rounded-xl bg-blue-50 p-3 dark:bg-blue-500/10"><Mail className="size-5 shrink-0 text-blue-500" /><div className="min-w-0"><p className="truncate text-xs font-semibold" data-no-translate>{recipient}</p><p className="mt-1 truncate text-xs text-muted-foreground" data-no-translate>{subject}</p></div></div>
        <div><h4 className="mb-2 flex items-center gap-2 text-xs font-semibold"><CalendarClock className="size-4" />When should we follow up?</h4><div className="grid grid-cols-4 gap-1.5">{["5 minutes", "1 hour", "Tomorrow", "Custom"].map(value => <button key={value} type="button" aria-pressed={preset === value} disabled={busy || generating} onClick={() => chooseTime(value)} className={`rounded-lg border px-1 py-2 text-xs focus-visible:outline-2 focus-visible:outline-ring ${preset === value ? "border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-500/10" : "bg-muted/30 text-muted-foreground"}`}>{value}</button>)}</div>
          <DatePicker includeTime required aria-label="Follow-up date and time" value={dueAt} disabled={busy || generating} onValueChange={value => { setDueAt(value); setPreset("Custom"); }} className="mt-3 w-full rounded-lg border bg-background px-3 py-2 text-xs" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">Your local time. Delivery runs on the next scheduler check.</p>
        </div>
        {kind === "ai" ? <div className="space-y-3"><div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold">Follow-up message</h4><button type="button" disabled={busy || generating || !aiConfigured} onClick={() => void generate()} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 disabled:opacity-40">{generating ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}{generating ? "Generating…" : body ? "Regenerate" : "Generate draft"}</button></div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-violet-100 bg-violet-50/40 p-3 text-xs leading-5 dark:border-violet-500/20 dark:bg-violet-500/5"><input type="checkbox" checked={nurture} disabled={busy || generating} onChange={event => setNurture(event.target.checked)} className="mt-1 accent-violet-600" /><span><span className="block font-medium">Add to dormant customer nurture</span><span className="text-muted-foreground">Track this conversation in the dormant tab. Sends this approved message once if there is no reply.</span></span></label>
          {!aiConfigured ? <p className="text-xs text-muted-foreground">Connect an AI provider in Settings, or write your follow-up below.</p> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">Subject<input required maxLength={300} disabled={busy || generating} value={draftSubject} onChange={event => setDraftSubject(event.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground" data-no-translate /></label>
          <label className="grid gap-1 text-xs text-muted-foreground">Message<textarea aria-label="Follow-up message" rows={7} maxLength={20000} disabled={busy || generating} value={body} onChange={event => setBody(event.target.value)} placeholder={generating ? "Preparing a follow-up from this conversation…" : "Write your follow-up…"} className="w-full resize-y rounded-lg border bg-background p-3 text-sm leading-6 text-foreground focus-visible:outline-2 focus-visible:outline-ring" data-no-translate /></label>
          <p className="text-[11px] text-muted-foreground">Your saved email footer will be added when this message sends.</p>
        </div> : null}
        <div className="flex gap-2 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><p>Stops automatically when the customer replies. A newer message from your team also stops this follow-up.</p></div>
        {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
        {!loaded && !loadError ? <p role="status" className="text-xs text-muted-foreground">Checking saved follow-up…</p> : null}
        {loadError ? <p role="alert" className="text-xs text-destructive">{loadError} <button type="button" onClick={() => setRetry(value => value + 1)} className="font-medium underline">Retry</button></p> : null}
        <div className="flex items-center justify-between gap-3 border-t pt-4"><p className="text-[11px] text-muted-foreground">{kind === "ai" ? "One email, only after you confirm" : "A reminder for you"}</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy || generating} onClick={() => setOpen(false)}>Close</Button><Button size="sm" disabled={busy || generating || !loaded || Boolean(loadError) || followup?.status === "processing" || followup?.status === "uncertain" || !dueAt || (kind === "ai" && (!body.trim() || !draftSubject.trim()))} onClick={() => void mutate("save")}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{busy ? "Saving…" : kind === "ai" ? "Confirm follow-up" : "Save reminder"}</Button></div></div>
      </DialogContent>
    </Dialog>
  </section>;
}
