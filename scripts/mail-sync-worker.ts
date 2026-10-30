// Receive-only worker. Run once in cron or continuously on a persistent Node host.
import { runMailSyncWorker } from "../lib/data/mail-sync-worker.ts";
import { closeMailboxSessions } from "../lib/mailbox-imap.ts";

let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; wake?.(); });
try {
  do {
    try { console.log(JSON.stringify({ at: new Date().toISOString(), ...await runMailSyncWorker({ budgetMs: 280_000 }) })); }
    catch (error) { console.error("Mail sync worker tick failed:", error instanceof Error ? error.message : (error as { message?: string })?.message || "Database request failed"); process.exitCode = 1; }
    if (process.argv.includes("--once") || stopping) break;
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 5000); wake = () => { clearTimeout(timer); resolve(); }; });
  } while (!stopping);
} finally { await closeMailboxSessions(); }
