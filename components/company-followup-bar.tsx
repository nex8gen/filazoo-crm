"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { CalendarDays, Clock3, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { scheduleCompanyFollowup } from "@/app/crm-actions";
import { followupInstant, followupLocalTime } from "@/lib/company-followup";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function CompanyFollowupBar({ companyId, nextFollowupAt, canWrite }: { companyId: string; nextFollowupAt: string | null; canWrite: boolean }) {
  const clientReady = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmed, setConfirmed] = useState<{ source: string | null; value: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const current = confirmed?.source === nextFollowupAt ? confirmed.value : nextFollowupAt;

  function save(dueAt: string) {
    if (!canWrite || pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await scheduleCompanyFollowup(companyId, dueAt);
        if (!result?.success) { setError(result?.error || "The follow-up could not be confirmed. Please retry."); return; }
        setConfirmed({ source: nextFollowupAt, value: dueAt || null });
        setOpen(false);
        toast.success(result.success);
        window.dispatchEvent(new Event("flow-activity-updated"));
      } catch {
        setError("The follow-up could not be saved. Please retry.");
      }
    });
  }

  function preset(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(9, 0, 0, 0);
    save(date.toISOString());
  }

  return <div className="company-followup-bar">
    <Clock3 aria-hidden="true" className="company-followup-icon" />
    <div className="company-followup-label"><span>Next follow-up</span>{current ? <time dateTime={current}>{clientReady ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(current)) : "Scheduled"}</time> : <strong>Not scheduled</strong>}</div>
    {canWrite ? <Popover open={open} onOpenChange={next => { if (pending) return; setOpen(next); if (next) { setCustom(false); setDraft(followupLocalTime(current)); setError(""); } }}>
      <PopoverTrigger render={<Button type="button" variant="default" size="sm" disabled={pending} />} className="company-followup-trigger">{pending ? <Loader2 className="animate-spin" /> : current ? <CalendarDays /> : <Plus />}{current ? "Reschedule" : "Schedule"}</PopoverTrigger>
      <PopoverContent align="end" className="company-followup-popover" aria-label="Schedule follow-up">
        <PopoverTitle>Schedule follow-up</PopoverTitle>
        {custom ? <form onSubmit={event => { event.preventDefault(); const instant = followupInstant(draft); if (instant) save(instant); }} className="space-y-3">
          <DatePicker aria-label="Follow-up date and time" includeTime value={draft} onValueChange={setDraft} disabled={pending} required />
          <p className="text-xs leading-5 text-muted-foreground">Time is in your local timezone. Creates a reminder for the account owner.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setCustom(false)}>Back</Button><Button type="submit" size="sm" disabled={pending || !draft}>{pending ? "Saving…" : "Save follow-up"}</Button></div>
        </form> : <div className="company-followup-options">
          <button type="button" disabled={pending} onClick={() => preset(1)}><CalendarDays /><span>Tomorrow</span><small>9:00 AM</small></button>
          <button type="button" disabled={pending} onClick={() => preset(7)}><CalendarDays /><span>Next week</span><small>9:00 AM</small></button>
          <button type="button" disabled={pending} onClick={() => setCustom(true)}><CalendarDays /><span>Choose date…</span></button>
          {current ? <button type="button" disabled={pending} onClick={() => save("")}><X /><span>Remove follow-up</span></button> : null}
        </div>}
        {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover> : null}
  </div>;
}
