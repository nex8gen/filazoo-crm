"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useRef, useState, useTransition } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { aiUsageAmount, aiUsageSettingsSchema, type AiUsageSettingsView } from "@/lib/ai/usage-settings";
import { updateAiUsageSettings } from "./ai-usage-actions";
import { useUnsavedSettings } from "./use-unsaved-settings";

const dollars = (micros: number) => String(micros / 1e6);
function draftOf(saved: AiUsageSettingsView) {
  return { monthly: dollars(saved.monthlyMicros), daily: saved.dailyMicros === null ? "" : dollars(saved.dailyMicros), shares: String(saved.minimumShares), members: saved.members.map(member => ({ ...member, daily: member.dailyMicros === null ? "" : dollars(member.dailyMicros) })) };
}

export function AiUsageSettingsForm({ initial, viewerId }: { initial: AiUsageSettingsView; viewerId: string }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  useUnsavedSettings(dirty);
  function change(next: typeof draft) { if (saving.current) return; setDraft(next); setError(""); setSuccess(false); }
  function save() {
    if (saving.current || pending || !dirty) return;
    const parsed = aiUsageSettingsSchema.safeParse({ revision: saved.revision, monthlyMicros: aiUsageAmount(draft.monthly), dailyMicros: aiUsageAmount(draft.daily), minimumShares: Number(draft.shares), members: draft.members.map(member => ({ userId: member.userId, enabled: member.enabled, dailyMicros: aiUsageAmount(member.daily) })) });
    if (!parsed.success) { setError("Enter valid spending limits with at most six decimal places. The monthly budget must be at least $0.01."); return; }
    saving.current = true;
    startTransition(async () => {
      setError(""); setSuccess(false);
      try {
        const result = await updateAiUsageSettings(parsed.data);
        if (result.error) setError(result.error);
        if ("saved" in result && result.saved) { setSaved(result.saved); setDraft(draftOf(result.saved)); setSuccess(true); }
      } catch { setError("Unable to save AI usage settings. Please retry."); }
      finally { saving.current = false; }
    });
  }
  return <section id="ai-usage-controls" aria-labelledby="ai-usage-heading" className="rounded-xl border bg-background p-5">
    <h2 id="ai-usage-heading" className="text-base font-semibold">AI usage & spending limits</h2>
    <p className="mt-1 text-sm leading-6 text-muted-foreground">Manage AI for every active member, including your own administrator account. All amounts are in USD.</p>
    <p className="mt-2 text-xs text-muted-foreground">This month: ${(saved.monthlyUsedMicros / 1e6).toFixed(3)} used. Daily allowances reset at midnight China time. Changes apply to new requests across chat, agents, email and background AI.</p>
    <form onSubmit={event => { event.preventDefault(); save(); }} className="mt-5 space-y-5">
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium" htmlFor="ai-monthly-budget"><span>Workspace monthly budget (USD)</span><Input id="ai-monthly-budget" type="number" required min="0.01" max="1000000" step="0.000001" value={draft.monthly} onChange={event => change({ ...draft, monthly: event.target.value })} /></label>
          <label className="space-y-2 text-sm font-medium" htmlFor="ai-daily-budget"><span>Workspace daily cap (USD)</span><Input id="ai-daily-budget" type="number" min="0" max="1000000" step="0.000001" placeholder="Automatic from monthly budget" value={draft.daily} onChange={event => change({ ...draft, daily: event.target.value })} /></label>
          <label className="space-y-2 text-sm font-medium" htmlFor="ai-shares"><span>Minimum allowance shares</span><Input id="ai-shares" type="number" required min="1" max="10000" step="1" value={draft.shares} onChange={event => change({ ...draft, shares: event.target.value })} /></label>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Leave a daily cap blank to use automatic sharing: monthly budget ÷ days in the month ÷ active members (at least the minimum shares). Set 0 to pause spending. Individual limits always remain within workspace caps. Saving limits preserves billed usage.</p>
        <div className="divide-y rounded-lg border px-4">{draft.members.map((member, index) => <div key={member.userId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium"><span data-no-translate>{member.name}</span>{member.userId === viewerId ? " (you)" : ""}</p><p className="mt-1 text-xs text-muted-foreground">{member.role} · Today: ${(member.usedMicros / 1e6).toFixed(3)} / ${(member.effectiveDailyMicros / 1e6).toFixed(3)}</p></div>
          <div className="flex flex-wrap items-end gap-4"><label htmlFor={`ai-limit-${member.userId}`} className="w-44 space-y-1.5 text-xs"><span>Daily limit (USD)</span><Input id={`ai-limit-${member.userId}`} aria-label={`Daily AI limit for ${member.name}`} type="number" min="0" max="1000000" step="0.000001" placeholder="Automatic share" value={member.daily} onChange={event => change({ ...draft, members: draft.members.map((value, position) => position === index ? { ...value, daily: event.target.value } : value) })} /></label><div className="flex h-9 items-center gap-2"><Switch id={`ai-enabled-${member.userId}`} aria-label={`Enable AI for ${member.name}`} disabled={pending} checked={member.enabled} onCheckedChange={enabled => change({ ...draft, members: draft.members.map((value, position) => position === index ? { ...value, enabled } : value) })} /><label htmlFor={`ai-enabled-${member.userId}`} className="text-xs">{member.enabled ? "Enabled" : "Paused"}</label></div></div>
        </div>)}</div>
      </fieldset>
      {error ? <NotificationToast>{error}</NotificationToast> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p role="status" aria-live="polite" className="text-xs text-muted-foreground">{pending ? "Saving usage limits…" : dirty ? "Unsaved usage limits" : success ? "AI usage limits saved." : "Only administrators can change usage limits."}</p><div className="flex gap-2">{dirty ? <Button type="button" variant="outline" disabled={pending} onClick={() => change(draftOf(saved))}>Discard</Button> : null}<Button type="submit" disabled={pending || !dirty}>{pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}Save usage limits</Button></div></div>
    </form>
  </section>;
}
