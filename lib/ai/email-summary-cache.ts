import { createHash } from "node:crypto";
import { parseEmailSummary } from "./email-summary.ts";

export type SavedEmailSummary = { output: string; generatedAt: string; cached: boolean };
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
  const content = { ...input };
  delete content.currentFollowUpAt;
  delete content.refreshSummary;
  // New matching metadata repairs existing saved cards without rebuying AI.
  delete content.messageDirection;
  return createHash("sha256").update(JSON.stringify(canonical({ version: 1, content, policy, role, model }))).digest("hex");
}

export class EmailSummaryPendingError extends Error {
  constructor() { super("Analysis is already running for this email."); }
}

/** A database lease also prevents duplicate charges across server instances. */
export async function reuseEmailSummary(store: EmailSummaryStore, token: string, generate: () => Promise<string>, refresh = false): Promise<SavedEmailSummary> {
  const saved = await store.read();
  if (!refresh && saved?.output && saved.generatedAt) {
    try {
      parseEmailSummary(saved.output);
      return { output: saved.output, generatedAt: saved.generatedAt, cached: true };
    } catch { /* Invalid old records can be replaced under the lease. */ }
  }
  if (!await store.claim(token)) throw new EmailSummaryPendingError();
  try {
    // A different server may have saved between our read and lease acquisition.
    const latest = !refresh ? await store.read() : null;
    if (latest?.output && latest.generatedAt) {
      try {
        parseEmailSummary(latest.output);
        return { output: latest.output, generatedAt: latest.generatedAt, cached: true };
      } catch { /* Replace invalid saved output. */ }
    }
    const output = await generate();
    parseEmailSummary(output);
    const generatedAt = new Date().toISOString();
    await store.complete(token, output, generatedAt);
    return { output, generatedAt, cached: false };
  } finally {
    await store.release(token);
  }
}
