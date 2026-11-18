"use client";

import type { MailSyncHealth } from "@/lib/mail-sync-jobs";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { EmailImportProgress } from "@/components/email-import-progress";

export function EmailSyncStatus({ health, lastSuccessAt, error, partialSnapshot = false }: { health: MailSyncHealth[]; lastSuccessAt?: string | null; error: string | null; partialSnapshot?: boolean }) {
  const reconnect = health.some((item) => item.state === "reconnect_required");
  const retrying = health.some((item) => item.state === "retrying");
  const stale = health.some((item) => item.state === "stale");
  const active = health.some((item) => item.state === "checking");
  const waiting = health.some((item) => item.state === "waiting");
  const success = health.length ? health.map((item) => item.lastSuccessAt).filter((date): date is string => Boolean(date)).sort()[0] : lastSuccessAt;
  const history = health.find((item) => item.history !== "idle") || health[0];
  const warning = Boolean(error || reconnect || stale || retrying);
  const label = error ? "Status unavailable" : reconnect ? "Mailbox sign-in required" : stale ? "Sync delayed" : retrying ? "Reconnecting…" : active ? "Checking new mail…" : waiting ? "Waiting for first sync" : success ? "Up to date" : "Checking status…";
  const imports = health.flatMap(item => item.histories?.map(entry => entry.health) || [item]);
  const importing = imports.some(item => item.history === "running" || item.history === "queued");
  const historyLabel = importing ? "Importing older emails" : imports.some(item => item.history === "retrying") ? "History will retry" : null;
  return <Popover>
    <PopoverTrigger aria-label={`Email sync details: ${historyLabel || label}`} className={`inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-muted ${warning ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${warning ? "bg-amber-500" : active || importing ? "animate-pulse bg-muted-foreground" : success ? "bg-emerald-500" : "bg-muted-foreground"}`} />
      <span role="status" aria-live="polite" className="truncate">{warning ? label : historyLabel || label}</span>
    </PopoverTrigger>
    <PopoverContent align="end" className="text-xs">
      <PopoverTitle>{label}</PopoverTitle>
      {success ? <p className="text-muted-foreground">Last checked: {new Date(success).toLocaleString()}</p> : null}
      {error ? <p className="text-muted-foreground">{error}</p> : null}
      {reconnect ? <Link href="/settings/apps?view=personal" className="underline">Check mailbox settings</Link> : null}
      {health.some(item => item.nextRetryAt) ? <p className="text-muted-foreground">Next retry: {new Date(health.find(item => item.nextRetryAt)!.nextRetryAt!).toLocaleTimeString()}</p> : null}
      <EmailImportProgress health={history} />
      {partialSnapshot ? <p className="text-muted-foreground">Some saved messages or details are still loading. They will retry automatically.</p> : null}
    </PopoverContent>
  </Popover>;
}
