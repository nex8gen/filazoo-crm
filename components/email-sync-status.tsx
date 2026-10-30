"use client";

import type { MailSyncHealth } from "@/lib/mail-sync-jobs";
import Link from "next/link";

export function EmailSyncStatus({ health, lastSuccessAt, error }: { health: MailSyncHealth[]; lastSuccessAt?: string | null; error: string | null }) {
  const reconnect = health.some((item) => item.state === "reconnect_required");
  const retrying = health.some((item) => item.state === "retrying");
  const stale = health.some((item) => item.state === "stale");
  const active = !health.length || health.some((item) => ["checking", "waiting"].includes(item.state));
  const success = health.length ? health.map((item) => item.lastSuccessAt).filter((date): date is string => Boolean(date)).sort()[0] : lastSuccessAt;
  const history = health.find((item) => item.history !== "idle");
  const warning = Boolean(error || reconnect || stale || health.some((item) => (item.failures || 0) >= 3));
  const label = error ? "Refresh unavailable" : reconnect ? "Mailbox sign-in required" : stale ? "Sync delayed" : retrying ? "Reconnecting…" : active ? "Syncing…" : "Synced";
  return <div role="status" aria-live="polite" className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
    <span className={`inline-flex items-center gap-1.5 ${warning ? "text-amber-700 dark:text-amber-300" : ""}`} title={success ? `Last checked: ${new Date(success).toLocaleString()}` : undefined}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${warning ? "bg-amber-500" : active || retrying ? "animate-pulse bg-muted-foreground" : "bg-emerald-500"}`} />
      {label}{reconnect ? <> · <Link href="/settings/mailboxes" className="underline">Check mailbox settings</Link></> : null}
    </span>
    {history ? <span>{history.history === "running" ? "Loading older mail…" : history.history === "retrying" ? "Older mail will retry" : "Older mail queued"}{history.historyTotal && history.historyImported !== undefined ? ` ${history.historyImported}/${history.historyTotal}` : ""}</span> : null}
  </div>;
}
