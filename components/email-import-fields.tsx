"use client";

import { useId, useState } from "react";
import { mailImportLimits, newMailImportPreferences, type MailImportPreferences } from "@/lib/mail-import";

export function EmailImportFields({ value, onChange, disabled = false }: { value: MailImportPreferences; onChange: (value: MailImportPreferences) => void; disabled?: boolean }) {
  const id = useId();
  const enabled = value.historyLimit > 50;
  return <fieldset disabled={disabled} className="space-y-4 rounded-lg border p-4">
    <legend className="px-1 text-sm font-medium">Email history</legend>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={event => onChange({ ...value, historyLimit: event.target.checked ? 500 : 50 })} />Import older emails</label>
    <p className="text-xs leading-5 text-muted-foreground">Your latest 50 emails appear first. New messages keep syncing automatically.</p>
    {enabled ? <div className="space-y-2"><label htmlFor={`${id}-limit`} className="text-sm font-medium">How many emails per folder?</label><select id={`${id}-limit`} value={value.historyLimit} onChange={event => onChange({ ...value, historyLimit: Number(event.target.value) })} className="h-10 w-full rounded-md border bg-background px-3 text-sm">{mailImportLimits.filter(limit => limit > 50).map(limit => <option key={limit} value={limit}>{limit.toLocaleString()} latest emails{limit === 500 ? " (recommended)" : ""}</option>)}</select><p className="text-xs leading-5 text-muted-foreground">Includes the first 50. Maximum 5,000 per folder; new emails continue to arrive after this import finishes.</p></div> : null}
    <div className="space-y-2"><label htmlFor={`${id}-folders`} className="text-sm font-medium">Folders for older history</label><select id={`${id}-folders`} value={value.historyFolders} onChange={event => onChange({ ...value, historyFolders: event.target.value as MailImportPreferences["historyFolders"] })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="inbox_sent">Inbox and Sent (recommended)</option><option value="all">All folders except Spam and Trash</option></select></div>
    <p className="text-xs leading-5 text-muted-foreground">You can change this later in Import settings. Importing continues when you leave this page. A time estimate appears once we measure your provider&apos;s speed.</p>
  </fieldset>;
}

export function ConnectionEmailImport({ disabled, defaultValue = newMailImportPreferences }: { disabled?: boolean; defaultValue?: MailImportPreferences }) {
  const [value, setValue] = useState(defaultValue);
  return <><input type="hidden" name="syncPreferences" value={JSON.stringify(value)} /><EmailImportFields value={value} onChange={setValue} disabled={disabled} /></>;
}
