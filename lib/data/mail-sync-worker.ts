import { randomUUID } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { normalizeMailboxRow } from "../mailbox-utils.ts";
import { mailSyncHealth, mailSyncInterval, mailSyncRetrySeconds, mailSyncBatchSize, type MailSyncJob, type MailSyncKind } from "../mail-sync-jobs.ts";
import { mailboxSyncKey, savedProviderFolders, loadSyncedMailbox } from "./mailbox-sync.ts";
import type { WorkspaceMailboxRecord } from "./mailboxes.ts";
import type { ProviderFolder } from "../email-provider.ts";

/** One warm cron worker at a time; the reserved cache row is server-only. */
export async function withMailSyncWorkerLease<T>(run: () => Promise<T>): Promise<T | { alreadyRunning: true }> {
  const db = createSupabaseAdmin();
  const key = "system:mail-sync-worker", token = randomUUID();
  await db.from("mailbox_sync_state").upsert({ mailbox_key: key }, { onConflict: "mailbox_key", ignoreDuplicates: true }).throwOnError();
  const now = new Date();
  const { data } = await db.from("mailbox_sync_state").update({ lease_token: token, lease_until: new Date(now.getTime() + 300_000).toISOString() })
    .eq("mailbox_key", key).or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`).select("mailbox_key").maybeSingle().throwOnError();
  if (!data) return { alreadyRunning: true };
  try { return await run(); }
  finally { await db.from("mailbox_sync_state").update({ lease_token: null, lease_until: null }).eq("mailbox_key", key).eq("lease_token", token).throwOnError(); }
}

/** Deduplication never resets a failed job's backoff or steals a running job. */
export async function enqueueMailboxSync(mailbox: WorkspaceMailboxRecord, options: { history?: boolean; folder?: string; refresh?: boolean } = {}) {
  const db = createSupabaseAdmin();
  const account = mailboxSyncKey(mailbox);
  const folders = await savedProviderFolders(mailbox);
  const folder = options.folder || "INBOX";
  if (folder !== "INBOX" && !folders.some((item) => item.path === folder)) throw new Error("Mailbox folder unavailable.");
  await db.from("mail_sync_accounts").upsert({ account_key: account, mailbox_id: mailbox.id }, { onConflict: "account_key", ignoreDuplicates: true }).throwOnError();
  const jobs: Array<{ kind: MailSyncKind; folder: string; priority: number }> = [{ kind: "inbox", folder: "INBOX", priority: 0 }, { kind: "discovery", folder: "INBOX", priority: 3 }];
  for (const item of [{ path: "INBOX" }, ...folders.filter((item) => item.kind !== "inbox")]) {
    if (item.path !== "INBOX") jobs.push({ kind: "folder", folder: item.path, priority: 5 });
    jobs.push({ kind: "flags", folder: item.path, priority: 20 }, { kind: "previews", folder: item.path, priority: item.path === "INBOX" ? 1 : 15 }, { kind: "history", folder: item.path, priority: 8 });
  }
  await db.from("mail_sync_jobs").upsert(jobs.map((job) => ({ ...job, account_key: account })), { onConflict: "account_key,kind,folder", ignoreDuplicates: true }).throwOnError();
  await db.from("mail_sync_jobs").update({ state: "queued", next_run_at: new Date().toISOString() })
    .eq("account_key", account).eq("state", "idle").neq("kind", "history").throwOnError();
  if (options.history) await db.from("mail_sync_jobs").update({ state: "queued", next_run_at: new Date().toISOString() })
    .eq("account_key", account).eq("kind", "history").eq("folder", folder).eq("state", "idle").throwOnError();
  if (options.refresh) await db.from("mail_sync_jobs").update({ next_run_at: new Date().toISOString() })
    .eq("account_key", account).eq("kind", folder === "INBOX" ? "inbox" : "folder").eq("folder", folder).eq("state", "queued").eq("attempts", 0).throwOnError();
  return folders;
}

export async function readMailboxSyncHealth(mailbox: WorkspaceMailboxRecord, fallback: string | null = null, folder = "INBOX") {
  const { data } = await createSupabaseAdmin().from("mail_sync_jobs").select("kind,folder,state,attempts,next_run_at,last_attempt_at,last_success_at,last_error,progress")
    .eq("account_key", mailboxSyncKey(mailbox)).in("kind", ["inbox", "folder", "history"]).throwOnError();
  return mailSyncHealth((data || []) as MailSyncJob[], fallback, Date.now(), folder);
}

/** One bounded receive-only job. No SMTP, automation actions, or UI lifecycle. */
type WorkerAccounts = Map<string, { mailbox: WorkspaceMailboxRecord; folders: ProviderFolder[]; loadedAt: number }>;
export async function runMailSyncJob(job: MailSyncJob, token: string, accounts?: WorkerAccounts) {
  const db = createSupabaseAdmin();
  const cached = accounts?.get(job.account_key);
  let mailbox = cached?.mailbox || null;
  if (!cached || Date.now() - cached.loadedAt > 30_000) {
    const { data: account } = cached ? { data: { mailbox_id: cached.mailbox.id } } : await db.from("mail_sync_accounts").select("mailbox_id").eq("account_key", job.account_key).single().throwOnError();
    const { data: row } = await db.from("workspace_mailboxes").select("*").eq("id", account.mailbox_id).maybeSingle().throwOnError();
    mailbox = row ? normalizeMailboxRow(row) : null;
    if (mailbox) accounts?.set(job.account_key, { mailbox, folders: cached?.folders || await savedProviderFolders(mailbox), loadedAt: Date.now() });
  }
  // Old identities stop receiving when settings change; the scheduler registers the new identity.
  if (!mailbox?.isActive || !mailbox.imapHost || !mailbox.imapUsername || !mailbox.imapPassword || mailboxSyncKey(mailbox) !== job.account_key) {
    await db.from("mail_sync_jobs").update({ state: "idle" }).eq("account_key", job.account_key).throwOnError();
    return;
  }
  if (job.kind === "discovery") {
    const { listMailboxFolders } = await import("../mailbox-imap.ts");
    const folders = await listMailboxFolders(mailbox);
    const { data: owned } = await db.from("mail_sync_accounts").select("account_key").eq("account_key", job.account_key).eq("lease_token", token).gt("lease_until", new Date().toISOString()).maybeSingle().throwOnError();
    if (!owned) throw new Error("Mailbox worker ownership expired.");
    await db.from("mailbox_provider_folders").upsert({ mailbox_key: job.account_key, folders, synced_at: new Date().toISOString() }).throwOnError();
    // Retire deleted/renamed folders instead of retrying them forever.
    const valid = new Set(["INBOX", ...folders.map((folder) => folder.path)]);
    const { data: existing } = await db.from("mail_sync_jobs").select("id,folder").eq("account_key", job.account_key).throwOnError();
    const removed = (existing || []).filter((item) => !valid.has(item.folder)).map((item) => item.id);
    if (removed.length) await db.from("mail_sync_jobs").delete().in("id", removed).throwOnError();
    await enqueueMailboxSync(mailbox);
    accounts?.set(job.account_key, { mailbox, folders, loadedAt: Date.now() });
    return {};
  }
  const folders = accounts?.get(job.account_key)?.folders || await savedProviderFolders(mailbox);
  const folder = folders.find((item) => item.path === job.folder);
  const batchSize = mailSyncBatchSize(job.kind, job.attempts, job.progress?.batchSize);
  const result = await loadSyncedMailbox(mailbox, { sync: true, includeContent: false, history: job.kind === "history", batchSize, folder: job.folder, kind: folder?.kind || "inbox",
    phase: job.kind === "flags" || job.kind === "previews" ? job.kind : "headers", worker: { account: job.account_key, token } });
  if (result.error) throw new Error(result.error);
  if (result.batch?.received && ["inbox", "folder", "history"].includes(job.kind)) {
    await db.from("mail_sync_jobs").update({ next_run_at: new Date().toISOString() }).eq("account_key", job.account_key).eq("kind", "previews").eq("folder", job.folder).eq("state", "queued").eq("attempts", 0).throwOnError();
  }
  if (job.kind === "inbox" || job.kind === "folder") {
    if (result.batch?.reset) await db.from("mail_sync_jobs").update({ state: "queued", next_run_at: new Date().toISOString(), progress: { completed: false } })
      .eq("account_key", job.account_key).eq("kind", "history").eq("folder", job.folder).eq("state", "idle").throwOnError();
  }
  return { ...(result.batch || {}), imported: result.messages.length, ...(["history", "previews"].includes(job.kind) ? { batchSize } : {}), ...(job.kind === "history" ? { completed: !result.batch?.hasMore } : {}) };
}

export async function runMailSyncWorker(options: { budgetMs?: number; maxJobs?: number; seed?: boolean; waitForWork?: boolean } = {}) {
  const { withMailboxSyncSessions } = await import("../mailbox-imap.ts");
  return withMailboxSyncSessions(() => drainMailSyncWorker(options));
}
async function drainMailSyncWorker(options: { budgetMs?: number; maxJobs?: number; seed?: boolean; waitForWork?: boolean }) {
  const db = createSupabaseAdmin();
  const deadline = Date.now() + (options.budgetMs ?? 280_000);
  const accounts: WorkerAccounts = new Map();
  if (options.seed !== false) {
    const { data } = await db.from("workspace_mailboxes").select("*").eq("is_active", true).throwOnError();
    for (const row of data || []) {
      const mailbox = normalizeMailboxRow(row);
      if (mailbox?.imapHost && mailbox.imapUsername && mailbox.imapPassword) {
        const folders = await enqueueMailboxSync(mailbox);
        accounts.set(mailboxSyncKey(mailbox), { mailbox, folders, loadedAt: Date.now() });
      }
    }
  }
  let processed = 0, failed = 0, started = 0;
  async function releaseFinishedOperation(token: string) {
    // A lost DB response must not strand an account for five minutes. These
    // callers have no provider operation running; CAS protects any new owner.
    try { await db.from("mail_sync_accounts").update({ lease_token: null, lease_until: null }).eq("lease_token", token).throwOnError(); }
    catch { /* During a database outage the existing lease expiry is the fallback. */ }
  }
  async function drain() {
    // Worker sessions bound connect + operation to 50s; foreground downloads keep 90s.
    while (started < (options.maxJobs ?? 128) && Date.now() < deadline - 55_000) {
      const token = randomUUID();
      let job: MailSyncJob | undefined;
      try {
        const { data } = await db.rpc("claim_mail_sync_job", { p_token: token }).throwOnError();
        job = data?.[0] as MailSyncJob | undefined;
      } catch (error) { await releaseFinishedOperation(token); throw error; }
      if (!job) {
        if (!options.waitForWork || Date.now() >= deadline - 58_000) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
        continue;
      }
      started++;
      let heartbeatError: Error | null = null;
      const heartbeat = setInterval(() => {
        void db.rpc("renew_mail_sync_lease", { p_account: job.account_key, p_token: token }).then(({ data, error }) => {
          if (!error && !data) heartbeatError = new Error("Mailbox worker lease could not be renewed.");
        }, () => { /* Fenced snapshot/finish RPCs still verify actual ownership. */ });
      }, 30_000);
      let error: string | null = null;
      let progress: NonNullable<Awaited<ReturnType<typeof runMailSyncJob>>> = {};
      try { progress = await runMailSyncJob(job, token, accounts) || {}; if (heartbeatError) throw heartbeatError; }
      catch (cause) { error = cause instanceof Error ? cause.message : "Mailbox job failed."; failed++; }
      finally { clearInterval(heartbeat); }
      try {
        const { data: finished } = await db.rpc("finish_mail_sync_job", { p_job: job.id, p_token: token, p_error: error,
          p_delay: error ? mailSyncRetrySeconds(job.attempts) : "hasMore" in progress && progress.hasMore ? 0 : mailSyncInterval[job.kind], p_progress: progress }).throwOnError();
        if (!finished) throw new Error("Mailbox worker lost ownership; its job will be recovered.");
      } catch (cause) { await releaseFinishedOperation(token); throw cause; }
      processed++;
    }
  }
  // Independent accounts progress together; database ownership serializes each account.
  const results = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(4, accounts.size || 4)) }, drain));
  for (const result of results) if (result.status === "rejected") throw result.reason;
  return { processed, failed };
}
