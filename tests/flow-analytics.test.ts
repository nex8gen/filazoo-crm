import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as metrics from "../lib/flow-analytics.ts";
import * as chartData from "../lib/flow-analytics-chart.ts";

const now = new Date("2026-11-16T12:00:00.000Z");
const flows: metrics.AnalyticsFlow[] = [{ id: "workspace", name: "Lead reply", status: "live" }, { id: "email", name: "Customer follow-up", status: "paused" }, { id: "empty", name: "Unused", status: "draft" }];
const run = (id: string, extra: Partial<metrics.AnalyticsRun> = {}): metrics.AnalyticsRun => ({ id, flow_id: "workspace", status: "done", started_at: "2026-11-11T00:00:00.000Z", finished_at: "2026-11-11T01:00:00.000Z", execution_state: null, ...extra });
const log = (id: string, run_id: string, action: string, extra: Partial<metrics.AnalyticsLog> = {}): metrics.AnalyticsLog => ({ id, run_id, created_at: "2026-11-12T00:00:00.000Z", error: null, result: { action }, ...extra });

test("workflow analytics counts real sends separately from completed, skipped, dry-run and failed runs", () => {
  const runs = [run("a"), run("b", { flow_id: "email", status: "failed", finished_at: "2026-11-13T00:00:00.000Z" }), run("c", { status: "active", started_at: "2026-09-01T00:00:00.000Z", finished_at: null, execution_state: "blocked" }), run("d", { status: "active", finished_at: null, execution_state: "retrying" })];
  const logs = [log("sent", "a", "email_sent", { result: { action: "email_sent", to: "Buyer@EXAMPLE.com", messageId: "one" } }), log("duplicate", "a", "email_sent", { result: { action: "email_sent", to: "buyer@example.com", messageId: "one" } }), log("second", "a", "email_sent", { result: { action: "email_sent", to: "buyer@example.com", messageId: "two" } }), log("skip", "a", "email_skipped"), log("dry", "b", "email_dry_run"), log("failure", "b", "", { error: "Sender unavailable" }), log("open", "a", "email_opened"), log("click", "a", "link_clicked"), log("outside", "unknown", "email_sent"), log("retry", "c", "action_blocked", { result: { action: "action_blocked", reason: "Reconnect mailbox" } })];
  const report = metrics.summarizeFlowAnalytics(flows, [...runs, runs[0]], [...logs, logs[0]], "7", now);
  const workspace = report.rows.find(row => row.id === "workspace")!, email = report.rows.find(row => row.id === "email")!;
  assert.equal(workspace.sent, 2); assert.equal(workspace.recipients, 1);
  assert.equal(workspace.completed, 1); assert.equal(workspace.skipped, 1);
  assert.equal(workspace.opens, 1); assert.equal(workspace.clicks, 1);
  assert.equal(workspace.active, 2); assert.equal(workspace.blocked, 1); assert.equal(workspace.retrying, 1);
  assert.equal(workspace.latestIssue, "Reconnect mailbox");
  assert.equal(email.sent, 0); assert.equal(email.failed, 1); assert.equal(email.errors, 1); assert.equal(email.dryRun, 1);
  assert.equal(email.latestIssue, "Sender unavailable");
  assert.equal(report.rows.find(row => row.id === "empty")!.sent, 0);
  assert.equal(report.series.workspace.reduce((sum, point) => sum + point.sent, 0), 2);
  assert.equal(report.series.email.reduce((sum, point) => sum + point.failed, 0), 1);
  assert.equal(JSON.stringify(report).includes("buyer@example.com"), false);
});

test("activity uses event dates, including old runs sending this week, with UTC boundaries and no future activity", () => {
  const old = run("old", { started_at: "2026-08-01T00:00:00.000Z", finished_at: "2026-08-02T00:00:00.000Z" });
  const logs = [log("before", "old", "email_sent", { created_at: "2026-11-09T23:59:59.999Z" }), log("start", "old", "email_sent", { created_at: "2026-11-10T00:00:00+00:00" }), log("future", "old", "email_sent", { created_at: "2026-11-16T12:00:00.001Z" })];
  const report = metrics.summarizeFlowAnalytics(flows, [old], logs, "7", now);
  const row = report.rows.find(row => row.id === "workspace")!;
  assert.equal(row.sent, 1); assert.equal(row.started, 0); assert.equal(row.completed, 0);
  assert.equal(report.from, "2026-11-10T00:00:00.000Z");
  assert.equal(report.series.workspace.length, 7);
  assert.equal(metrics.analyticsRange("nonsense"), "30");
  assert.equal(metrics.analyticsRange(["7"]), "30");
  assert.equal(metrics.analyticsRange("all"), "all");
  const all = metrics.summarizeFlowAnalytics(flows, [old], logs, "all", now);
  assert.equal(all.rows.find(row => row.id === "workspace")!.sent, 2);
  const monthly = metrics.summarizeFlowAnalytics(flows, [run("long", { started_at: "2020-01-01T00:00:00.000Z" })], [], "all", now);
  assert.equal(monthly.bucket, "month"); assert.ok(monthly.series.workspace.length < 100);
});

test("CSV keeps commas and newlines intact and prevents spreadsheet formulas", () => {
  const row = metrics.summarizeFlowAnalytics([{ ...flows[0], name: '=HYPERLINK("x"),\nFlow' }], [], [], "7", now).rows[0];
  row.latestIssue = "+formula";
  const csv = metrics.flowAnalyticsCsv([row]);
  assert.ok(csv.includes('"\'=HYPERLINK(""x""),\nFlow"'));
  assert.ok(csv.includes('"\'+formula"'));
  assert.ok(csv.includes("Emails sent")); assert.ok(!csv.includes("Delivered"));
});

type Row = Record<string, unknown>;
function dataFixture(role: string | null = "viewer") {
  const calls: Array<{ table: string; from: number }> = [];
  const rows: Record<string, Row[]> = {
    flow_runs: Array.from({ length: 1205 }, (_, index) => run(`run-${index}`)),
    flow_run_logs: Array.from({ length: 1205 }, (_, index) => log(`log-${index}`, `run-${index}`, "email_sent")),
  };
  rows.flow_runs.push(run("hidden", { flow_id: "hidden" }));
  rows.flow_run_logs.push(log("hidden", "hidden", "email_sent"));
  let failure = false;
  const client = { from(table: string) {
    let data = [...rows[table]], offset = 0, end = 499;
    const query = {
      select() { return query; },
      in(key: string, ids: unknown[]) { data = data.filter(row => ids.includes(row[key])); return query; },
      lte(key: string, value: string) { data = data.filter(row => String(row[key]) <= value); return query; },
      gte(key: string, value: string) { data = data.filter(row => String(row[key]) >= value); return query; },
      order() { return query; },
      range(from: number, to: number) { offset = from; end = to; return query; },
      then(resolve: (value: unknown) => unknown) { calls.push({ table, from: offset }); return Promise.resolve({ data: failure ? null : data.slice(offset, end + 1), count: data.length, error: failure ? { message: "Database unavailable" } : null }).then(resolve); },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = { "server-only": {}, "../auth.ts": { requireWorkspaceMember: async () => { if (!role) throw new Error("Access denied"); return { role }; } }, "../supabase/admin.ts": { createSupabaseAdmin: () => client }, "./flows.ts": { listWorkspaceFlows: async () => flows }, "../flow-analytics.ts": metrics };
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/flow-analytics.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { calls, rows, client, fail: () => { failure = true; }, read: exports.readFlowAnalytics as (client: unknown, flows: metrics.AnalyticsFlow[], range: metrics.FlowAnalyticsRange, now: Date) => Promise<metrics.FlowAnalyticsReport>, get: exports.getFlowAnalytics as (range: metrics.FlowAnalyticsRange) => Promise<{ report: metrics.FlowAnalyticsReport; canEdit: boolean }> };
}

test("analytics paginates runs and events beyond 1000, and queries only visible workflow IDs", async () => {
  const fixture = dataFixture();
  const report = await fixture.read(fixture.client, flows, "7", now);
  assert.equal(report.rows.find(row => row.id === "workspace")!.sent, 1205);
  assert.equal(report.rows.find(row => row.id === "workspace")!.completed, 1205);
  assert.ok(fixture.calls.some(call => call.table === "flow_runs" && call.from === 1000));
  assert.equal(JSON.stringify(report).includes("hidden"), false);
  const empty = dataFixture();
  assert.equal((await empty.read(empty.client, [], "7", now)).rows.length, 0);
  assert.equal(empty.calls.length, 0);
});

test("viewers can read analytics, nonmembers cannot query, and query failures never become zero counts", async () => {
  const viewer = await dataFixture().get("all");
  assert.equal(viewer.canEdit, false);
  const denied = dataFixture(null);
  await assert.rejects(() => denied.get("7"), /Access denied/); assert.equal(denied.calls.length, 0);
  const broken = dataFixture(); broken.fail();
  await assert.rejects(() => broken.read(broken.client, flows, "7", now), /Database unavailable/);
});

type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

function analyticsUi() {
  const report = metrics.summarizeFlowAnalytics(flows, [run("a"), run("b", { flow_id: "email", status: "failed" })], [log("send", "a", "email_sent"), log("error", "b", "", { error: "Mailbox rejected" })], "7", now);
  const states: unknown[] = [], navigations: string[] = [], downloads: string[] = [];
  let cursor = 0;
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const dependencies = new Proxy({
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: { useState: (initial: unknown) => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], (next: unknown) => { states[index] = next; }]; }, useMemo: (fn: () => unknown) => fn(), useTransition: () => [false, (fn: () => void) => fn()] },
    "next/navigation": { useRouter: () => ({ push: (url: string) => navigations.push(url), refresh() {} }) },
    "next/link": { default: "Link" },
    "next/dynamic": { default: () => "FlowAnalyticsChart" },
    "@/components/ui/button": { Button: "Button", buttonVariants: () => "button" },
    "@/components/language-provider": { useLanguage: () => ({ language: "en" }) },
    "@/lib/flow-analytics": metrics,
    "@/lib/flow-analytics-chart": chartData,
    "@/components/flow-analytics-chart": { FlowAnalyticsChart: "FlowAnalyticsChart" },
  }, { get: (target, name) => Reflect.get(target, name) ?? components });
  const exports: Record<string, (props: unknown) => Element> = {};
  const FakeURL = { createObjectURL: () => "blob:report", revokeObjectURL() {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/flow-analytics.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (name: string) => dependencies[name], Intl, Date, URLSearchParams, URL: FakeURL, Blob, setTimeout: (fn: () => void) => fn(), document: { createElement: () => ({ href: "", download: "", click() { downloads.push(this.download); } }) } });
  const render = (canEdit = true) => { cursor = 0; return exports.FlowAnalytics({ report, canEdit }); };
  return { report, render, navigations, downloads };
}

test("analytics controls filter the combined report, switch metrics, navigate dates and export the selected rows", () => {
  const app = analyticsUi();
  let tree = app.render();
  const pagination = (value: Element) => elements(value).find(node => node.type === "TablePagination")!;
  assert.equal(pagination(tree).props.total, 3);
  assert.ok(elements(tree).some(node => node.type === "FlowViewToggle" && node.props.active === "analytics"));
  assert.ok(elements(tree).some(node => node.props.href === "/workflow?create=1"));
  const search = elements(tree).find(node => node.type === "Input")!;
  (search.props.onChange as (event: unknown) => void)({ target: { value: "Customer" } });
  tree = app.render(); assert.equal(pagination(tree).props.total, 1);
  const control = (value: Element, label: string) => elements(value).find(node => typeof node.type === "function" && node.type.name === "AnalyticsSelect" && node.props.label === label)!;
  (control(tree, "Date range").props.onChange as (value: string) => void)("90");
  assert.equal(app.navigations[0], "/workflow/analytics?range=90&q=Customer");
  (control(tree, "Chart metric").props.onChange as (value: string) => void)("failed");
  tree = app.render();
  assert.equal(elements(tree).find(node => node.type === "FlowAnalyticsChart")!.props.metric, "failed");
  const exportButton = elements(tree).find(node => node.type === "Button" && Array.isArray(node.props.children) && node.props.children.includes("Export CSV"))!;
  (exportButton.props.onClick as () => void)();
  assert.equal(app.downloads[0], "workflow-analytics-7-2026-11-16.csv");
  (control(tree, "Status").props.onChange as (value: string) => void)("live");
  assert.equal(pagination(app.render()).props.total, 0);
  assert.equal(elements(app.render(false)).some(node => node.props.href === "/workflow?create=1"), false);
});

test("chart and table render both real activity and clear empty states", () => {
  const app = analyticsUi();
  const tree = app.render();
  const chart = elements(tree).find(node => node.type === "FlowAnalyticsChart")!;
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: Element["type"], props: Element["props"]) => ({ type, props });
  const exports = {} as { FlowAnalyticsChart: (props: Element["props"]) => Element };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/flow-analytics-chart.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Intl, Date, require: (name: string) => name === "react" ? { useMemo: (fn: () => unknown) => fn() } : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : name === "next/link" ? { default: "Link" } : name === "@/lib/flow-analytics-chart" ? chartData : components,
  });
  const output = exports.FlowAnalyticsChart(chart.props);
  assert.ok(elements(output).some(node => node.type === "ChartContainer"));
  assert.ok(elements(output).some(node => node.type === "LineChart" && node.props.accessibilityLayer));
  assert.ok(elements(output).some(node => node.type === "Tooltip"));
  assert.ok(elements(output).some(node => node.type === "YAxis" && node.props.allowDecimals === false));
  assert.ok(elements(output).some(node => node.props.href === "/workflow?flow=workspace"));
  const empty = exports.FlowAnalyticsChart({ ...chart.props, rows: [] });
  assert.ok(JSON.stringify(empty).includes("No activity in this period"));
});

test("chart ranks workflows by the selected metric and aligns sparse points by date", () => {
  const report = metrics.summarizeFlowAnalytics(flows, [], [], "7", now);
  report.rows[0].sent = 3; report.rows[1].sent = 8;
  const point = (date: string, sent: number): metrics.FlowAnalyticsPoint => ({ date, sent, failed: 0, skipped: 0 });
  const result = chartData.prepareFlowAnalyticsChart(report.rows, {
    [report.rows[0].id]: [point("2026-11-12", 3)],
    [report.rows[1].id]: [point("2026-11-11", 5), point("2026-11-13", 3)],
  }, "sent");
  assert.equal(result.workflows[0].id, report.rows[1].id);
  assert.deepEqual(result.data, [
    { date: "2026-11-11", flow_0: 5, flow_1: 0 },
    { date: "2026-11-12", flow_0: 0, flow_1: 3 },
    { date: "2026-11-13", flow_0: 3, flow_1: 0 },
  ]);
  assert.equal(chartData.prepareFlowAnalyticsChart(report.rows, {}, "sent").data.length, 0);
  assert.equal(chartData.prepareFlowAnalyticsChart(report.rows, {}, "failed").workflows.length, 0);
});
