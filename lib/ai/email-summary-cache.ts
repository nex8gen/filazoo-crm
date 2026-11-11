import { createHash } from "node:crypto";
import { parseEmailSummary } from "./email-summary.ts";

export type SavedEmailSummary = { output: string; generatedAt: string; cached: boolean };
export type EmailSummaryUpdate = {
  messageId: string;
  messageTimestamp?: string;
  update: (saved: string) => Promise<string>;
  legacyKey?: string;
};
export type EmailSummaryStore = {
  read: () => Promise<{ output: string | null; generatedAt: string | null } | null>;
  claim: (token: string) => Promise<boolean>;
  complete: (token: string, output: string, generatedAt: string) => Promise<void>;
  release: (token: string) => Promise<void>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Scheduling writes and the clock must never invalidate an unchanged brief. */
export function emailSummaryCacheKey(input: Record<string, unknown>, policy: unknown, role: string, model?: string) {
  if (input.conversationId) {
    // The assessment belongs to the thread, not its latest message or mutable CRM profile.
    return createHash("sha256").update(JSON.stringify(canonical({ version: 2,
      conversationId: input.conversationId, mailboxId: input.mailboxId, policy, role,
    }))).digest("hex");
  }
  const content = { ...input };
  delete content.currentFollowUpAt;
  delete content.refreshSummary;
  // New matching metadata repairs existing saved cards without rebuying AI.
  delete content.messageDirection;
  delete content.messageTimestamp;
  return createHash("sha256").update(JSON.stringify(canonical({ version: 1, content, policy, role, model }))).digest("hex");
}

export class EmailSummaryPendingError extends Error {
  constructor() { super("Analysis is already running for this email."); }
}

/** A database lease also prevents duplicate charges across server instances. */
export async function reuseEmailSummary(store: EmailSummaryStore, token: string, generate: () => Promise<string>, refresh = false, update?: EmailSummaryUpdate): Promise<SavedEmailSummary> {
  function valid(saved: Awaited<ReturnType<EmailSummaryStore["read"]>>) {
    if (!saved?.output || !saved.generatedAt) return null;
    try { parseEmailSummary(saved.output); return { output: saved.output, generatedAt: saved.generatedAt }; }
    catch { return null; }
  }
  function revision(output: string) {
    try { return JSON.parse(output)._lastMessage as { id: string; timestamp?: string } | undefined; }
    catch { return undefined; }
  }
  function unchanged(output: string) {
    if (!update) return !refresh;
    const last = revision(output);
    // Ignore a delayed request for an older message after a newer reply was saved.
    return last?.id === update.messageId || Boolean(last?.timestamp && update.messageTimestamp
      && Date.parse(last.timestamp) > Date.parse(update.messageTimestamp));
  }
  const saved = await store.read();
  const initial = valid(saved);
  if (initial && unchanged(initial.output)) return { ...initial, cached: true };
  if (!await store.claim(token)) throw new EmailSummaryPendingError();
  try {
    // A different server may have saved between our read and lease acquisition.
    const latest = valid(await store.read());
    if (latest && unchanged(latest.output)) return { ...latest, cached: true };
    // Adopt old content-addressed briefs without paying to research them again.
    const adopting = Boolean(update && latest && !revision(latest.output));
    let output: string;
    if (update && latest) output = adopting ? latest.output : await update.update(latest.output);
    else output = await generate();
    parseEmailSummary(output);
    if (update) output = JSON.stringify({ ...parseEmailSummary(output), _lastMessage: { id: update.messageId, timestamp: update.messageTimestamp } });
    const generatedAt = adopting && latest ? latest.generatedAt : new Date().toISOString();
    await store.complete(token, output, generatedAt);
    return { output, generatedAt, cached: adopting };
  } finally {
    await store.release(token);
  }
}
