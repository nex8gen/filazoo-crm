"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, CloudCheck, LoaderCircle, RotateCcw } from "lucide-react";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailFooterSettings } from "./email-footer-settings";
import { defaultUserPreferences, type UserPreferences } from "@/lib/user-preferences";
import { saveUserPreferences, signOutOtherSessions } from "./preference-actions";

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
      {section === "general" ? <div className="grid items-start gap-4 sm:grid-cols-[1fr_10rem]"><div><Label htmlFor="tablePageSize">Rows per page</Label><p id="page-size-description" className="mt-1.5 text-xs leading-5 text-muted-foreground">Applies to companies, company catalogs, Meta leads, and team member lists.</p></div><Select value={draft.tablePageSize} onValueChange={value => { if (value !== null) save({ tablePageSize: Number(value) as UserPreferences["tablePageSize"] }); }} disabled={pending}><SelectTrigger id="tablePageSize" aria-describedby="page-size-description" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50, 100].map(size => <SelectItem key={size} value={size}>{size} rows</SelectItem>)}</SelectContent></Select></div> : null}
      {section === "appearance" ? <><div className="grid gap-4 sm:grid-cols-[1fr_12rem]"><div><Label htmlFor="density">Table density</Label><p id="density-description" className="mt-1.5 text-xs leading-5 text-muted-foreground">Adjusts cell spacing in CRM tables.</p></div><Select value={draft.density} onValueChange={value => { if (value !== null) save({ density: value as UserPreferences["density"] }); }} disabled={pending}><SelectTrigger id="density" aria-describedby="density-description" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="comfortable">Comfortable</SelectItem><SelectItem value="compact">Compact</SelectItem></SelectContent></Select></div><div aria-hidden="true" className="overflow-hidden rounded-xl border bg-muted/20"><div className="flex gap-6 border-b bg-muted/40 px-4 py-3"><span className="settings-preview-line w-1/3" /><span className="settings-preview-line w-1/4" /><span className="settings-preview-line w-1/5" /></div>{[0, 1, 2].map(row => <div key={row} className={`flex gap-6 border-b px-4 last:border-0 ${draft.density === "compact" ? "py-2" : "py-4"}`}><span className="settings-preview-line w-1/3" /><span className="settings-preview-line w-1/4" /><span className="settings-preview-line w-1/5" /></div>)}</div><div className="border-t pt-5">{toggle("reduceMotion", "Reduce motion", "Minimize animations and smooth scrolling. Your device’s reduced motion preference is also respected.")}</div></> : null}
      {section === "email" ? <><div className="divide-y">{toggle("emailTranslate", "Translate inbound emails to Chinese", "Sets the initial translation switch in the inbox and company email views. You can change it while reading.")}{toggle("emailMarkRead", "Mark conversations as read when opened", "Turn off to keep unread messages unread until you mark them manually.")}{toggle("emailAiSuggestions", "Show AI reply suggestions", "Sets the initial AI suggestion switch when reading a conversation. Replies still require sending manually.")}</div><div className="grid gap-4 border-t pt-5 sm:grid-cols-[1fr_12rem]"><div><Label htmlFor="emailSyncSeconds">Automatic inbox refresh</Label><p id="refresh-description" className="mt-1.5 text-xs leading-5 text-muted-foreground">Refreshes while the inbox is visible. Manual sync stays available. Background automation runs independently.</p></div><Select value={draft.emailSyncSeconds} onValueChange={value => { if (value !== null) save({ emailSyncSeconds: Number(value) as UserPreferences["emailSyncSeconds"] }); }} disabled={pending}><SelectTrigger id="emailSyncSeconds" aria-describedby="refresh-description" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[0, 15, 30, 60, 120].map(seconds => <SelectItem key={seconds} value={seconds}>{seconds === 0 ? "Manual only" : `Every ${seconds} seconds`}</SelectItem>)}</SelectContent></Select></div></> : null}
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p role="status" aria-live="polite" className={`flex items-center gap-2 text-xs ${saved ? "text-primary" : "text-muted-foreground"}`}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : saved ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <CloudCheck aria-hidden="true" className="size-4" />}{pending ? "Saving…" : saved ? "Preferences saved to your account." : "Changes save automatically to your account."}</p><Button type="button" variant="ghost" size="sm" disabled={pending || isDefault} onClick={() => save(Object.fromEntries(keys.map(key => [key, defaultUserPreferences[key]])))}><RotateCcw aria-hidden="true" className="size-3.5" />Restore defaults</Button></div>
  </div>{section === "email" ? <EmailFooterSettings /> : null}</>;
}

export function SessionSettings() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: string }>({});
  return <div className="space-y-4"><p className="text-xs leading-5 text-muted-foreground">Revokes other sessions while keeping this device signed in. Existing access tokens remain valid until they expire.</p><Button variant="outline" disabled={pending} onClick={() => { setResult({}); startTransition(async () => { try { setResult(await signOutOtherSessions()); } catch { setResult({ error: "Unable to sign out other devices. Please try again." }); } }); }}>{pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}{pending ? "Signing out other devices..." : "Sign out other devices"}</Button>{result.error ? <p role="alert" className="text-sm text-destructive">{result.error}</p> : null}{result.success ? <p role="status" className="text-sm text-primary">{result.success}</p> : null}</div>;
}
