export type MailSyncKind = "inbox" | "folder" | "history" | "flags" | "previews" | "discovery";
export type MailSyncJob = {
  id: string; account_key: string; kind: MailSyncKind; folder: string;
  state: "queued" | "running" | "idle"; attempts: number; next_run_at: string;
  last_attempt_at: string | null; last_success_at: string | null; last_error: string | null;
  progress?: { hasMore?: boolean; completed?: boolean; imported?: number; totalMessages?: number; batchSize?: number };
};
export type MailSyncHealth = {
  state: "waiting" | "checking" | "up_to_date" | "stale" | "retrying" | "reconnect_required";
  lastSuccessAt: string | null; nextRetryAt: string | null;
  history: "idle" | "queued" | "running" | "retrying";
  historyImported?: number; historyTotal?: number; historyComplete?: boolean; failures?: number;
};
export const mailSyncInterval: Record<MailSyncKind, number> = { inbox: 15, folder: 120, history: 0, flags: 300, previews: 120, discovery: 3600 };
export function mailSyncBatchSize(kind: MailSyncKind, attempts: number, previousSize?: number) {
  const size = kind === "history" ? attempts === 0 ? 200 : attempts === 1 ? 50 : 25
    : kind === "previews" ? attempts === 0 ? 25 : attempts === 1 ? 10 : 1 : 100;
  // Keep a successful reduced batch across retries; successful jobs reset attempts.
  return ["history", "previews"].includes(kind) && previousSize && Number.isInteger(previousSize) && previousSize > 0 ? Math.min(size, previousSize) : size;
}
export function mailSyncRetrySeconds(attempts: number, random = Math.random()) {
  return Math.min(1800, 30 * 2 ** Math.min(6, Math.max(0, attempts))) + Math.floor(Math.max(0, Math.min(1, random)) * 15);
}
export function mailboxNeedsReconnect(error: string | null) {
  return Boolean(error && /authentication failed|invalid credentials|login failed|authenticationfailed|authorizationfailed|invalid password|account.*disabled/i.test(error));
}
export function mailSyncHealth(jobs: MailSyncJob[], lastSuccessAt: string | null = null, now = Date.now(), folder = "INBOX"): MailSyncHealth {
  const latest = jobs.find((job) => job.kind === (folder === "INBOX" ? "inbox" : "folder") && job.folder === folder);
  const history = jobs.find((job) => job.kind === "history" && job.folder === folder);
  const success = latest?.last_success_at || lastSuccessAt;
  const running = latest?.state === "running" && now - Date.parse(latest.last_attempt_at || "") < 300_000;
  const state = running ? "checking" : latest?.last_error ? (mailboxNeedsReconnect(latest.last_error) ? "reconnect_required" : "retrying") : !success ? "waiting" : now - Date.parse(success) > 180_000 ? "stale" : "up_to_date";
  return { state, lastSuccessAt: success, nextRetryAt: latest?.last_error ? latest.next_run_at : null,
    history: !history || history.state === "idle" ? "idle" : history.last_error || history.state === "running" && now - Date.parse(history.last_attempt_at || "") >= 300_000 ? "retrying" : history.state,
    historyImported: history?.progress?.imported, historyTotal: history?.progress?.totalMessages, historyComplete: Boolean(history?.progress?.completed), failures: latest?.attempts || 0 };
}
