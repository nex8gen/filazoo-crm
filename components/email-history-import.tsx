"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmailImportFields } from "@/components/email-import-fields";
import { EmailImportProgress } from "@/components/email-import-progress";
import { newMailImportPreferences, type MailImportPreferences } from "@/lib/mail-import";
import type { MailSyncHealth } from "@/lib/mail-sync-jobs";

export function EmailHistoryImport({ mailboxId, providerFolder, health, onChange }: { mailboxId: string; providerFolder?: string; health?: MailSyncHealth; onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<MailImportPreferences>(newMailImportPreferences);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setOpen(true); setBusy(true); setReady(false); setError(""); setMessage("");
    try {
      const params = new URLSearchParams({ mailboxId, ...(providerFolder ? { providerFolder } : {}) });
      const response = await fetch(`/api/email/sync?${params}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import settings are unavailable.");
      setValue(result.preferences); setCanManage(result.canManage); setReady(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load import settings."); }
    finally { setBusy(false); }
  }

  async function save(operation: "configure" | "pause" | "resume") {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/email/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailboxId, operation, preferences: { ...value, historyPaused: false } }), signal: AbortSignal.timeout(30_000) });
      const result = await response.json();
      if (result.preferences) setValue(result.preferences);
      if (!response.ok) throw new Error(result.error || "Import settings could not be saved.");
      setMessage(result.queued ? "Import queued. New messages continue syncing. You can close this window." : "History import paused. The current batch may finish; new messages keep syncing.");
      await onChange();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update import settings."); }
    finally { setBusy(false); }
  }

  return <><button type="button" onClick={() => void load()} className="shrink-0 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">Import settings</button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Email import settings</DialogTitle><DialogDescription>Choose how much history to load for this account. This limit applies to each selected folder. New-mail syncing runs separately.</DialogDescription></DialogHeader>
      <EmailImportProgress health={health} />
      {ready ? <><EmailImportFields value={value} onChange={setValue} disabled={busy || !canManage} />{canManage ? <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void save(value.historyPaused ? "resume" : "pause")}>{value.historyPaused ? "Resume history import" : "Pause history import"}</Button><Button type="button" disabled={busy} onClick={() => void save("configure")}>{busy ? "Saving…" : "Save and start import"}</Button></div> : <p className="text-xs text-muted-foreground">A team administrator can change these import settings.</p>}</> : busy ? <p role="status" className="text-sm text-muted-foreground">Loading import settings…</p> : <Button type="button" variant="outline" onClick={() => void load()}>Retry loading settings</Button>}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}{message ? <p role="status" className="text-xs text-muted-foreground">{message}</p> : null}
    </DialogContent></Dialog>
  </>;
}
