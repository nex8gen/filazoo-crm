import type { FlowStatus } from "./flows.ts";

export const flowAnalyticsRanges = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", all: "All time" } as const;
export type FlowAnalyticsRange = keyof typeof flowAnalyticsRanges;
export type AnalyticsFlow = { id: string; name: string; status: FlowStatus };
export type AnalyticsRun = { id: string; flow_id: string; status: string; started_at: string; finished_at: string | null; execution_state: string | null };
export type AnalyticsLog = { id: string; run_id: string; created_at: string; error: string | null; result: { action?: string; messageId?: string | null; to?: string; reason?: string } | null };
export type FlowAnalyticsCounts = { sent: number; recipients: number; skipped: number; dryRun: number; errors: number; opens: number; clicks: number; started: number; completed: number; failed: number; cancelled: number; active: number; blocked: number; retrying: number };
export type FlowAnalyticsRow = AnalyticsFlow & FlowAnalyticsCounts & { latestIssue: string | null; lastActivity: string | null };
export type FlowAnalyticsPoint = { date: string; sent: number; failed: number; skipped: number };
export type FlowAnalyticsReport = { range: FlowAnalyticsRange; from: string | null; asOf: string; rows: FlowAnalyticsRow[]; series: Record<string, FlowAnalyticsPoint[]>; bucket: "day" | "month" };

export function analyticsRange(value: unknown): FlowAnalyticsRange {
  return typeof value === "string" && Object.hasOwn(flowAnalyticsRanges, value) ? value as FlowAnalyticsRange : "30";
}

export function analyticsStart(range: FlowAnalyticsRange, now: Date): string | null {
  if (range === "all") return null;
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Number(range) + 1);
  return start.toISOString();
}

export function emptyFlowAnalyticsCounts(): FlowAnalyticsCounts {
  return { sent: 0, recipients: 0, skipped: 0, dryRun: 0, errors: 0, opens: 0, clicks: 0, started: 0, completed: 0, failed: 0, cancelled: 0, active: 0, blocked: 0, retrying: 0 };
}

// Email sends are recorded SMTP acceptances. Completion of a run is never
// evidence that an email was sent or delivered to the recipient's inbox.
export function summarizeFlowAnalytics(flows: AnalyticsFlow[], runs: AnalyticsRun[], logs: AnalyticsLog[], range: FlowAnalyticsRange, now = new Date()): FlowAnalyticsReport {
  const asOf = now.toISOString(), from = analyticsStart(range, now);
  const inPeriod = (date: string) => Number.isFinite(Date.parse(date)) && (!from || Date.parse(date) >= Date.parse(from)) && Date.parse(date) <= now.getTime();
  const rows = new Map(flows.map(flow => [flow.id, { ...flow, ...emptyFlowAnalyticsCounts(), latestIssue: null, lastActivity: null } as FlowAnalyticsRow]));
  const runFlows = new Map<string, string>();
  const recipients = new Map<string, Set<string>>();
  const issueDates = new Map<string, string>();
  const series: Record<string, FlowAnalyticsPoint[]> = {};
  const points = new Map<string, Map<string, FlowAnalyticsPoint>>();
  const dates = [from || asOf, ...runs.filter(run => rows.has(run.flow_id)).map(run => run.started_at), ...logs.map(log => log.created_at)].filter(inPeriod).sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = from || dates[0] || asOf;
  const bucket = (Date.parse(asOf) - Date.parse(first)) / 86_400_000 > 120 ? "month" : "day";
  const key = (date: string) => bucket === "month" ? `${new Date(date).toISOString().slice(0, 7)}-01` : new Date(date).toISOString().slice(0, 10);
  const timeline: string[] = [];
  const cursor = new Date(`${key(first)}T00:00:00.000Z`);
  while (cursor.toISOString() <= asOf) {
    timeline.push(key(cursor.toISOString()));
    if (bucket === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const flow of flows) {
    recipients.set(flow.id, new Set());
    const values = timeline.map(date => ({ date, sent: 0, failed: 0, skipped: 0 }));
    series[flow.id] = values;
    points.set(flow.id, new Map(values.map(point => [point.date, point])));
  }
  const activity = (row: FlowAnalyticsRow, date: string) => { if (inPeriod(date) && (!row.lastActivity || Date.parse(date) > Date.parse(row.lastActivity))) row.lastActivity = date; };
  for (const run of runs) {
    const row = rows.get(run.flow_id);
    if (!row || runFlows.has(run.id)) continue;
    runFlows.set(run.id, run.flow_id);
    if (Date.parse(run.started_at) > now.getTime()) continue;
    if (inPeriod(run.started_at)) row.started++;
    if (run.status === "active") {
      row.active++;
      if (run.execution_state === "blocked") row.blocked++;
      if (run.execution_state === "retrying") row.retrying++;
    }
    const finished = run.finished_at || run.started_at;
    if (inPeriod(finished)) {
      if (run.status === "done") row.completed++;
      if (run.status === "cancelled") row.cancelled++;
      if (run.status === "failed") { row.failed++; const point = points.get(row.id)?.get(key(finished)); if (point) point.failed++; }
    }
    activity(row, run.started_at);
    if (run.finished_at) activity(row, run.finished_at);
  }
  const seenLogs = new Set<string>(), sent = new Set<string>();
  for (const log of logs) {
    const flowId = runFlows.get(log.run_id), row = flowId ? rows.get(flowId) : undefined;
    if (!row || seenLogs.has(log.id) || !inPeriod(log.created_at)) continue;
    seenLogs.add(log.id);
    activity(row, log.created_at);
    const action = log.result?.action;
    if (action === "email_sent") {
      const sendKey = `${row.id}:${log.result?.messageId || log.id}`;
      if (!sent.has(sendKey)) {
        sent.add(sendKey); row.sent++;
        const point = points.get(row.id)?.get(key(log.created_at)); if (point) point.sent++;
        // Missing historical recipient addresses are not guessed from run IDs.
        if (log.result?.to) recipients.get(row.id)!.add(log.result.to.trim().toLowerCase());
      }
    }
    if (action === "email_skipped") { row.skipped++; const point = points.get(row.id)?.get(key(log.created_at)); if (point) point.skipped++; }
    if (action === "email_dry_run") row.dryRun++;
    if (action === "email_opened") row.opens++;
    if (action === "link_clicked") row.clicks++;
    if (log.error) row.errors++;
    const issue = log.error || (["action_blocked", "retry_scheduled"].includes(action || "") ? log.result?.reason : null);
    if (issue && (!issueDates.has(row.id) || Date.parse(log.created_at) >= Date.parse(issueDates.get(row.id)!))) { row.latestIssue = issue; issueDates.set(row.id, log.created_at); }
  }
  for (const row of rows.values()) row.recipients = recipients.get(row.id)!.size;
  return { range, from, asOf, rows: [...rows.values()].sort((a, b) => b.sent - a.sent || b.failed - a.failed || a.name.localeCompare(b.name)), series, bucket };
}

export function flowAnalyticsCsv(rows: FlowAnalyticsRow[]): string {
  const headers = ["Workflow", "Status", "Emails sent", "Recipients", "Skipped", "Dry runs", "Error events", "Open events", "Click events", "Runs started", "Completed runs", "Failed runs", "Stopped runs", "Active now", "Blocked now", "Retrying now", "Last activity (UTC)", "Latest issue"];
  const cell = (value: string | number | null) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [headers, ...rows.map(row => [row.name, row.status, row.sent, row.recipients, row.skipped, row.dryRun, row.errors, row.opens, row.clicks, row.started, row.completed, row.failed, row.cancelled, row.active, row.blocked, row.retrying, row.lastActivity, row.latestIssue])].map(row => row.map(cell).join(",")).join("\r\n");
}
