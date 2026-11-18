"use client";

import type { MailSyncHealth } from "@/lib/mail-sync-jobs";
import { importTimeEstimate } from "@/lib/mail-import";

export function EmailImportProgress({ health }: { health?: MailSyncHealth }) {
  const folders = health?.histories?.filter(item => item.health.historyReason !== "not_selected");
  if (!folders?.length) return <EmailFolderImportProgress health={health} />;
  return <div className="max-h-64 space-y-4 overflow-y-auto pr-1">{folders.map(item => <section key={item.folder} className="space-y-1.5"><p className="text-xs font-semibold">{item.folder === "INBOX" ? "Inbox" : item.folder}</p><EmailFolderImportProgress health={item.health} /></section>)}</div>;
}

function EmailFolderImportProgress({ health }: { health?: MailSyncHealth }) {
  if (!health) return <p className="text-xs text-muted-foreground">Import status will appear after the first check.</p>;
  const imported = health.historyImported;
  const target = Math.min(health.historyTarget || 5000, health.historyTotal ?? Infinity);
  const active = health.history !== "idle";
  const label = health.history === "retrying" ? "Import will retry automatically" : health.history === "running" ? "Importing older emails" : health.history === "queued" ? "Import queued" : health.historyReason === "paused" ? "History import paused" : health.historyReason === "not_selected" ? "History import is off for this folder" : health.historyReason === "limit" ? "Selected import limit reached" : health.historyComplete || health.historyReason === "complete" ? "All available history imported" : "Ready to import";
  const estimate = active && health.history !== "retrying" && imported !== undefined ? importTimeEstimate(Math.max(0, target - imported), health.historyReceived || 0, health.historyElapsedMs || 0) : null;
  return <div className="space-y-2 text-xs" role="status" aria-live="polite">
    <p className="font-medium">{label}</p>
    {imported !== undefined ? <><p className="text-muted-foreground">{imported.toLocaleString()} emails loaded · import target {target.toLocaleString()}{health.historyTotal !== undefined ? ` · ${health.historyTotal.toLocaleString()} at provider` : ""}</p><progress aria-label="Email history import progress" className="h-1.5 w-full accent-primary" max={Math.max(1, target)} value={Math.min(imported, target)} /></> : null}
    {health.historyElapsedMs ? <p className="text-muted-foreground">Time spent importing: {Math.max(1, Math.round(health.historyElapsedMs / 1000)) < 60 ? `${Math.max(1, Math.round(health.historyElapsedMs / 1000))} seconds` : `${Math.round(health.historyElapsedMs / 60000)} minutes`}</p> : null}
    {active ? <p className="text-muted-foreground">{health.history === "retrying" ? health.historyNextRetryAt ? `Next retry: ${new Date(health.historyNextRetryAt).toLocaleTimeString()}` : "Waiting for the provider to recover." : estimate || "Estimating time after the first batches…"}</p> : null}
    {estimate ? <p className="text-muted-foreground">Estimated from import speed so far. Provider limits and new-mail checks can change this.</p> : null}
    {health.historyReason === "limit" && !active ? <p className="text-muted-foreground">Older emails remain at your provider. Increase the target in Import settings, up to 5,000 per folder. Provider search can find older messages.</p> : null}
  </div>;
}
