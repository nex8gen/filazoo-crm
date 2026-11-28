"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useState, useTransition } from "react";
import { CheckCircle2, LoaderCircle, RotateCcw } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultUserPreferences, type UserPreferences } from "@/lib/user-preferences";
import { saveUserPreferences } from "./preference-actions";

export function PreferencesForm({ section }: { section: "general" | "appearance" | "email" }) {
  const { preferences, setPreferences } = usePreferences();
  const [patch, setPatch] = useState<Partial<UserPreferences>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const draft = { ...preferences, ...patch };
  const keys = section === "general" ? ["tablePageSize"] as const : section === "appearance" ? ["density", "reduceMotion"] as const : ["emailTranslate", "emailMarkRead", "emailSyncSeconds", "emailAiSuggestions"] as const;
  const isDefault = keys.every(key => preferences[key] === defaultUserPreferences[key]);

  function save(next: Partial<UserPreferences>) {
    if (pending) return;
    setPatch(next); setError(""); setSaved(false);
    startTransition(async () => {
      try {
        const result = await saveUserPreferences({ ...preferences, ...next });
        if (result.error) setError(result.error);
        else if (result.preferences) { setPreferences(result.preferences); setSaved(true); }
      } catch { setError("Unable to save preferences. Please try again."); }
      finally { setPatch({}); }
    });
  }

  function toggle(key: "reduceMotion" | "emailTranslate" | "emailMarkRead" | "emailAiSuggestions", label: string, description: string) {
    const id = `preference-${key}`;
    return <div className="flex items-center justify-between gap-6 py-5 first:pt-0"><div className="min-w-0"><Label id={`${id}-label`} htmlFor={id} className="cursor-pointer text-sm font-medium">{label}</Label><p id={`${id}-description`} className="mt-1.5 max-w-lg text-xs leading-5 text-muted-foreground">{description}</p></div><Switch id={id} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} checked={draft[key]} onCheckedChange={checked => save({ [key]: checked })} disabled={pending} /></div>;
  }

  return <><div aria-busy={pending} className="space-y-5">
    <fieldset disabled={pending} className="min-w-0 space-y-5 disabled:opacity-70">
      {section === "general" ? <div className="settings-preference-row"><div><Label htmlFor="tablePageSize">Rows per page</Label><p id="page-size-description" className="mt-1.5 text-xs leading-5 text-muted-foreground">Companies, company catalogs, Meta leads, and team members.</p></div><Select value={draft.tablePageSize} onValueChange={value => { if (value !== null) save({ tablePageSize: Number(value) as UserPreferences["tablePageSize"] }); }} disabled={pending}><SelectTrigger id="tablePageSize" aria-describedby="page-size-description" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50, 100].map(size => <SelectItem key={size} value={size}>{size} rows</SelectItem>)}</SelectContent></Select></div> : null}
      {section === "appearance" ? <><div className="settings-preference-row"><div><Label htmlFor="density">Table density</Label><p id="density-description" className="mt-1.5 text-xs leading-5 text-muted-foreground">Adjusts cell spacing in CRM tables.</p></div><Select value={draft.density} onValueChange={value => { if (value !== null) save({ density: value as UserPreferences["density"] }); }} disabled={pending}><SelectTrigger id="density" aria-describedby="density-description" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="comfortable">Comfortable</SelectItem><SelectItem value="compact">Compact</SelectItem></SelectContent></Select></div><div aria-hidden="true" className="settings-panel overflow-hidden"><div className="flex gap-6 border-b bg-muted/30 px-3 py-2"><span className="settings-preview-line w-1/3" /><span className="settings-preview-line w-1/4" /><span className="settings-preview-line w-1/5" /></div>{[0, 1, 2].map(row => <div key={row} className={`flex gap-6 border-b px-4 last:border-0 ${draft.density === "compact" ? "py-1.5" : "py-2.5"}`}><span className="settings-preview-line w-1/3" /><span className="settings-preview-line w-1/4" /><span className="settings-preview-line w-1/5" /></div>)}</div><div className="border-t pt-5">{toggle("reduceMotion", "Reduce motion", "Reduce animations and smooth scrolling. Device preferences also apply.")}</div></> : null}
      {section === "email" ? <><div className="divide-y">{toggle("emailTranslate", "Translate inbound emails to Chinese", "Translate incoming emails by default. You can change this while reading.")}{toggle("emailMarkRead", "Mark conversations as read when opened", "Turn off to keep unread messages unread until you mark them manually.")}{toggle("emailAiSuggestions", "Show AI reply suggestions", "Show writing suggestions while reading. You choose whether to send a reply.")}</div><div className="settings-preference-row border-t pt-5"><div><Label htmlFor="emailSyncSeconds">Automatic inbox refresh</Label><p id="refresh-description" className="mt-1.5 text-xs leading-5 text-muted-foreground">Refresh while the inbox is open. Background mail sync continues.</p></div><Select value={draft.emailSyncSeconds} onValueChange={value => { if (value !== null) save({ emailSyncSeconds: Number(value) as UserPreferences["emailSyncSeconds"] }); }} disabled={pending}><SelectTrigger id="emailSyncSeconds" aria-describedby="refresh-description" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[0, 15, 30, 60, 120].map(seconds => <SelectItem key={seconds} value={seconds}>{seconds === 0 ? "On open or return" : `Every ${seconds} seconds`}</SelectItem>)}</SelectContent></Select></div></> : null}
    </fieldset>
    {error ? <NotificationToast>{error}</NotificationToast> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p role="status" aria-live="polite" className={`flex items-center gap-2 text-xs ${saved ? "text-primary" : "text-muted-foreground"}`}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : saved ? <CheckCircle2 aria-hidden="true" className="size-4" /> : null}{pending ? "Saving…" : saved ? "Saved" : "Saves automatically"}</p><Button type="button" variant="ghost" size="sm" disabled={pending || isDefault} onClick={() => save(Object.fromEntries(keys.map(key => [key, defaultUserPreferences[key]])))}><RotateCcw aria-hidden="true" className="size-3.5" />Restore defaults</Button></div>
  </div></>;
}
