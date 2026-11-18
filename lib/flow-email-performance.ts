import type { JsonConfig } from "./flows.ts";
import { analyticsStart } from "./flow-analytics.ts";

export type EmailPerformance = { sent: number; opens: number; clicks: number; openRate: number | null; clickRate: number | null; skipped: number; waiting: number; review: number };
export type EmailAiSpend = { recordedUsd: number | null; requests: number; pending: number; untracked: boolean };
export type EmailPerformanceReport = { asOf: string; from: string; actions: Record<string, EmailPerformance>; costs?: Record<string, EmailAiSpend> };
export type EmailPerformanceLog = { id: string; run_id: string; step_id?: string | null; created_at: string; error?: string | null; result: JsonConfig | null };
export type EmailPerformanceRun = { id: string; status: string; current_step: number; context: JsonConfig | null };
export function emptyEmailPerformance(): EmailPerformance { return { sent: 0, opens: 0, clicks: 0, openRate: null, clickRate: null, skipped: 0, waiting: 0, review: 0 }; }

/** Use the durable cursor in the run's expanded branch snapshot, rather than today's root indices. */
function currentEmailAction(run: EmailPerformanceRun): string | null {
  const retry = run.context?.preparationRetry;
  let steps: Array<{ id?: string; config?: JsonConfig }> = [];
  try {
    const definition = run.context?.definition;
    const parsed = typeof definition === "string" ? JSON.parse(definition) : definition;
    if (Array.isArray(parsed)) steps = parsed;
  } catch { /* Historical malformed snapshots cannot be assigned to an action. */ }
  const identity = (step: typeof steps[number] | undefined) => typeof step?.config?.performanceId === "string" ? step.config.performanceId : step?.id;
  if (retry && typeof retry === "object" && !Array.isArray(retry) && typeof retry.stepId === "string") return identity(steps.find(step => step.id === retry.stepId)) || retry.stepId;
  const current = identity(steps[run.current_step]); if (current) return current;
  const checkpoint = run.context?.executionCheckpoint;
  return checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) && typeof checkpoint.stepId === "string" ? checkpoint.stepId : null;
}

export function summarizeEmailPerformance(logs: EmailPerformanceLog[], runs: EmailPerformanceRun[], now = new Date()): EmailPerformanceReport {
  const from = analyticsStart("30", now)!;
  const actions: Record<string, EmailPerformance> = Object.create(null);
  const row = (id: string) => actions[id] ??= emptyEmailPerformance();
  const stepId = (log: EmailPerformanceLog) => typeof log.result?.performanceId === "string" ? log.result.performanceId : typeof log.result?.stepId === "string" ? log.result.stepId : log.step_id;
  const inPeriod = (log: EmailPerformanceLog) => Date.parse(log.created_at) >= Date.parse(from) && Date.parse(log.created_at) <= now.getTime();
  const events = [...new Map(logs.filter(inPeriod).map(log => [log.id, log])).values()];
  const sent = new Set<string>(), skipped = new Set<string>(), opened = new Set<string>(), clicked = new Set<string>();
  const key = (id: string, runId: string) => JSON.stringify([id, runId]);
  for (const log of events) {
    const id = stepId(log); if (!id) continue;
    const message = key(id, log.run_id);
    if (log.result?.action === "email_sent" && !sent.has(message)) { sent.add(message); row(id).sent++; }
    if (log.result?.action === "email_skipped" && !skipped.has(message)) { skipped.add(message); row(id).skipped++; }
  }
  // Unique opened/clicked messages from this period's sends; scanners and repeat events cannot push rates over 100%.
  for (const log of events) {
    const id = stepId(log); if (!id) continue;
    const message = key(id, log.run_id); if (!sent.has(message)) continue;
    if (log.result?.action === "email_opened" && !opened.has(message)) { opened.add(message); row(id).opens++; }
    if (log.result?.action === "link_clicked" && !clicked.has(message)) { clicked.add(message); row(id).clicks++; }
  }
  for (const run of new Map(runs.map(run => [run.id, run])).values()) {
    if (!["active", "failed"].includes(run.status)) continue;
    const id = currentEmailAction(run); if (!id || sent.has(key(id, run.id)) || skipped.has(key(id, run.id))) continue;
    if (run.status === "failed" || run.context?.executionState === "blocked") row(id).review++;
    else row(id).waiting++;
  }
  for (const value of Object.values(actions)) {
    if (value.sent) { value.openRate = value.opens / value.sent * 100; value.clickRate = value.clicks / value.sent * 100; }
  }
  const costs: Record<string, EmailAiSpend> = Object.create(null);
  const spend = (id: string) => costs[id] ??= { recordedUsd: null, requests: 0, pending: 0, untracked: false };
  const usageRuns = new Set<string>(), generations = new Map<string, EmailPerformanceLog>();
  const hasCost = (log: EmailPerformanceLog) => typeof log.result?.costUsd === "number" && Number.isFinite(log.result.costUsd) && log.result.costUsd >= 0;
  const lifetime = [...new Map(logs.filter(log => Date.parse(log.created_at) <= now.getTime()).map(log => [log.id, log])).values()];
  for (const log of lifetime) {
    const id = stepId(log); if (!id || log.result?.action !== "ai_usage") continue;
    usageRuns.add(key(id, log.run_id));
    const generation = typeof log.result.generationId === "string" ? log.result.generationId : log.id;
    if (!generations.has(generation) || !hasCost(generations.get(generation)!) && hasCost(log)) generations.set(generation, log);
  }
  for (const log of generations.values()) {
    const id = stepId(log)!;
    const value = spend(id); value.requests++;
    const cost = log.result!.costUsd;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) value.recordedUsd = Number(((value.recordedUsd ?? 0) + cost).toFixed(10));
    else value.pending++;
    if (!log.result!.generationId || log.result!.costExternal === true || log.result!.costLookupUnavailable === true) value.untracked = true;
  }
  for (const log of lifetime) {
    const id = stepId(log);
    if (id && log.result?.action === "email_sent" && log.result.aiGenerated === true && !usageRuns.has(key(id, log.run_id))) spend(id).untracked = true;
  }
  return { from, asOf: now.toISOString(), actions, costs };
}

export function emailAiSpend(value?: EmailAiSpend): string {
  if (!value || value.recordedUsd === null) return value?.untracked ? "Not recorded" : value?.pending ? "Pending" : "—";
  const amount = value.recordedUsd > 0 && value.recordedUsd < 0.0001 ? "<$0.0001" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value.recordedUsd);
  return `${amount}${value.pending || value.untracked ? "+" : ""}`;
}

export function emailRate(rate: number | null, count: number): string {
  return rate === null ? "—" : `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(rate)}% (${count})`;
}
