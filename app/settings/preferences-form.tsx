"use client";

import { useState, useTransition } from "react";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { defaultUserPreferences } from "@/lib/user-preferences";
import { saveUserPreferences, signOutOtherSessions } from "./preference-actions";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";

export function PreferencesForm({ section }: { section: "general" | "appearance" | "email" }) {
  const { preferences, setPreferences } = usePreferences();
  const [draft, setDraft] = useState(preferences);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const keys = section === "general" ? ["tablePageSize"] as const : section === "appearance" ? ["density", "reduceMotion"] as const : ["emailTranslate", "emailMarkRead", "emailSyncSeconds", "emailAiSuggestions", "emailSignature"] as const;
  const dirty = keys.some((key) => draft[key] !== preferences[key]);
  const submit = () => startTransition(async () => {
    setError(""); setNotice("");
    const patch = Object.fromEntries(keys.map((key) => [key, draft[key]]));
    try {
      const result = await saveUserPreferences({ ...preferences, ...patch });
      if (result.error) setError(result.error);
      else if (result.preferences) { setPreferences(result.preferences); setDraft(result.preferences); setNotice("Preferences saved to your account."); }
    } catch { setError("Unable to save preferences. Please try again."); }
  });
  const toggle = (key: "reduceMotion" | "emailTranslate" | "emailMarkRead" | "emailAiSuggestions", label: string, description: string) => <label className="flex cursor-pointer items-start justify-between gap-5 rounded-lg border p-4"><span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span><input type="checkbox" checked={draft[key]} onChange={(event) => { setDraft({ ...draft, [key]: event.target.checked }); setNotice(""); }} className="mt-1 size-4 shrink-0 accent-current" /></label>;
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="space-y-5">
    <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
      {section === "general" ? <div className="space-y-2"><Label htmlFor="tablePageSize">Rows per page</Label><select id="tablePageSize" className={selectClass} value={draft.tablePageSize} onChange={(event) => setDraft({ ...draft, tablePageSize: Number(event.target.value) as typeof draft.tablePageSize })}>{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size} rows</option>)}</select><p className="text-xs leading-5 text-muted-foreground">Applies to companies, company catalogs, Meta leads, and team member lists.</p></div> : null}
      {section === "appearance" ? <><div className="space-y-2"><Label htmlFor="density">Table density</Label><select id="density" className={selectClass} value={draft.density} onChange={(event) => setDraft({ ...draft, density: event.target.value as typeof draft.density })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select><p className="text-xs text-muted-foreground">Adjusts cell spacing in CRM tables.</p></div>{toggle("reduceMotion", "Reduce motion", "Minimize animations and smooth scrolling. Your device’s reduced motion preference is also respected.")}</> : null}
      {section === "email" ? <>{toggle("emailTranslate", "Translate inbound emails to Chinese", "Sets the initial translation switch in the inbox and company email views. You can change it while reading.")}{toggle("emailMarkRead", "Mark conversations as read when opened", "Turn off to keep unread messages unread until you mark them manually.")}{toggle("emailAiSuggestions", "Show AI reply suggestions", "Sets the initial AI suggestion switch when reading a conversation. Replies still require sending manually.")}<div className="space-y-2"><Label htmlFor="emailSyncSeconds">Automatic inbox refresh</Label><select id="emailSyncSeconds" className={selectClass} value={draft.emailSyncSeconds} onChange={(event) => setDraft({ ...draft, emailSyncSeconds: Number(event.target.value) as typeof draft.emailSyncSeconds })}>{[0, 15, 30, 60, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds === 0 ? "Manual only" : `Every ${seconds} seconds`}</option>)}</select><p className="text-xs leading-5 text-muted-foreground">Refreshes while the inbox is visible. Manual sync stays available. Background automation runs independently.</p></div><div className="space-y-2"><Label htmlFor="emailSignature">Email signature</Label><Textarea id="emailSignature" value={draft.emailSignature} maxLength={2000} rows={5} onChange={(event) => setDraft({ ...draft, emailSignature: event.target.value })} placeholder="Your name, title, company, and contact details" /><p className="text-xs leading-5 text-muted-foreground">Plain text appended to emails and replies you send from the inbox or company email view. Automated messages use their own templates.</p></div>{draft.emailSignature.trim() ? <div className="rounded-lg border bg-muted/30 p-4"><p className="mb-2 text-xs font-medium text-muted-foreground">Signature preview</p><p data-no-translate className="whitespace-pre-wrap break-words text-sm">{draft.emailSignature}</p></div> : null}</> : null}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!dirty}>{pending ? "Saving..." : "Save preferences"}</Button><Button type="button" variant="outline" onClick={() => { setDraft(preferences); setError(""); setNotice(""); }} disabled={!dirty}>Discard changes</Button><Button type="button" variant="ghost" onClick={() => { setDraft({ ...preferences, ...Object.fromEntries(keys.map((key) => [key, defaultUserPreferences[key]])) }); setNotice(""); }}>Restore defaults</Button></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <p role="status" className="text-xs text-muted-foreground">{notice || (dirty ? "You have unsaved changes." : "Preferences sync with your account across devices.")}</p>
  </form>;
}

export function SessionSettings() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: string }>({});
  return <div className="space-y-3"><Button variant="outline" disabled={pending} onClick={() => startTransition(async () => setResult(await signOutOtherSessions()))}>{pending ? "Signing out other devices..." : "Sign out other devices"}</Button>{result.error ? <p role="alert" className="text-sm text-destructive">{result.error}</p> : null}{result.success ? <p role="status" className="text-sm text-muted-foreground">{result.success}</p> : null}<p className="text-xs leading-5 text-muted-foreground">Revokes other sessions while keeping this device signed in. Existing access tokens remain valid until they expire.</p></div>;
}
