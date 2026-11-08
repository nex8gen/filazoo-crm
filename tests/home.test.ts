import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { buildHomePeriod, buildHomeReport, homePreviousRange, resolveHomeRange, type HomeInputs } from "../lib/home.ts";
import { defaultHomeMetrics, homeMetricValue, normalizeHomeMetrics, replaceHomeMetric } from "../lib/home-metrics.ts";

const now = new Date("2026-11-08T16:30:00Z"); // November 9 in the workspace timezone.
function fixture(): HomeInputs {
  return {
    companies: [{ id: "a", ownerId: "alice", stage: "won", createdAt: "2026-10-01T00:00:00Z" }, { id: "b", ownerId: "bob", stage: "interested", createdAt: "2026-11-08T16:10:00Z" }, { id: "u", ownerId: null, stage: "new", createdAt: "2026-11-01T00:00:00Z" }],
    emails: [{ ownerId: "alice", sentAt: "2026-11-08T16:10:00Z" }, { ownerId: "bob", sentAt: "2026-11-08T15:59:00Z" }, { ownerId: null, sentAt: "2026-11-08T16:10:00Z" }],
    orders: [{ companyId: "a", date: "2026-11-09", status: "confirmed", currency: "USD", totalMinor: 10000 }, { companyId: "a", date: "2026-11-09", status: "draft", currency: "USD", totalMinor: 90000 }, { companyId: "b", date: "2026-11-09", status: "cancelled", currency: "USD", totalMinor: 90000 }, { companyId: "a", date: "2026-11-08", status: "confirmed", currency: "EUR", totalMinor: 20000 }, { companyId: "u", date: "2026-11-09", status: "confirmed", currency: "USD", totalMinor: 5000 }, { companyId: "missing", date: "2026-11-09", status: "confirmed", currency: "USD", totalMinor: 99999 }],
    members: [{ id: "alice", name: "Alice", role: "bd_manager" }, { id: "bob", name: "Bob", role: "bd_manager" }],
  };
}

test("Home applies UTC+8 periods and keeps wins as an honest current snapshot", () => {
  const today = buildHomePeriod(fixture(), "today", now, true);
  assert.equal(today.metrics.newCompanies, 1);
  assert.equal(today.metrics.emailsSent, 2);
  assert.equal(today.metrics.orders, 2);
  assert.equal(today.metrics.wonCustomers, 1);
  assert.equal(today.metrics.openOpportunities, 2);
  assert.equal(buildHomePeriod(fixture(), "month", now, true).metrics.emailsSent, 3);
  assert.equal(buildHomePeriod(fixture(), "all", now, true).metrics.newCompanies, 3);
});

test("performance uses the actual email sender and current account owner without mixing currencies", () => {
  const input = fixture();
  input.emails.push({ ownerId: "bob", sentAt: "2026-11-09T01:00:00Z" });
  const result = buildHomePeriod(input, "month", now, true);
  assert.deepEqual(result.metrics.orderValues, [{ currency: "EUR", minor: 20000 }, { currency: "USD", minor: 15000 }]);
  assert.equal(result.team.find(row => row.id === "alice")?.orders, 2);
  assert.equal(result.team.find(row => row.id === "bob")?.emailsSent, 2);
  assert.equal(result.team.reduce((sum, row) => sum + row.orders, 0), 2, "unassigned orders never credited to a teammate");
  assert.deepEqual(buildHomePeriod(input, "all", now, false).team, []);
});

test("performance cards track each member's sales and new customers for the selected dates", () => {
  const input = fixture();
  input.members[0].avatarUrl = "/avatars/alice.png";
  const today = buildHomeReport(input, undefined, now, true);
  const month = buildHomeReport(input, { from: "2026-11-01", to: "2026-11-09" }, now, true);
  assert.deepEqual(today.team[0].orderValues, [{ currency: "USD", minor: 10000 }]);
  assert.deepEqual(month.team[0].orderValues, [{ currency: "EUR", minor: 20000 }, { currency: "USD", minor: 10000 }]);
  assert.equal(today.team[0].avatarUrl, "/avatars/alice.png");
  assert.equal(today.team.find(row => row.id === "bob")?.newCustomers, 1);
  assert.equal(today.team.find(row => row.id === "alice")?.newCustomers, 0);
  assert.equal(today.team[0].customers, month.team[0].customers, "assigned customers remain a current snapshot");
  const past = buildHomeReport(input, { from: "2026-10-01", to: "2026-10-31" }, now, true);
  assert.equal(past.team.find(row => row.id === "alice")?.newCustomers, 1);
  assert.deepEqual(past.team.find(row => row.id === "alice")?.orderValues, []);
  assert.ok(month.team.every(member => member.orderValues.every(value => value.minor !== 99999)), "orphaned, unassigned, draft and cancelled orders are not credited");
});

function readerFixture(role: string, failedTable?: string, paginated = false) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const tables: Record<string, unknown[]> = {
    companies: [{ id: "a", created_at: "2026-11-09T01:00:00Z", pipeline: { owner_id: "alice", stage: "won" } }],
    emails: [{ owner_id: "alice", sent_at: "2026-11-09T01:00:00Z", created_at: "2026-11-09T01:00:00Z" }],
    purchase_orders: [], workspace_members: [{ user_id: "alice", display_name: "Alice", role: "bd_manager" }],
  };
  const client = { from(table: string) {
    calls.push({ table, op: "from", args: [] });
    const query: Record<string, unknown> = {};
    for (const op of ["select", "or", "eq", "not", "order"]) query[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return query; };
    query.range = async (from: number) => {
      calls.push({ table, op: "range", args: [from] });
      if (failedTable === table) return { data: null, count: null, error: { message: "offline" } };
      const rows = tables[table];
      return { data: paginated && from > 0 ? [] : rows, count: rows.length + (paginated ? 1 : 0), error: null };
    };
    return query;
  } };
  const exports: Record<string, () => Promise<import("../lib/home.ts").HomeData>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../lib/data/home.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const deps: Record<string, unknown> = {
    "server-only": {}, "../auth.ts": { requireWorkspaceMember: async () => ({ id: "alice", role, displayName: "Alice", workspaceName: "Test" }) },
    "../supabase/admin.ts": { createSupabaseAdmin: () => client }, "../home.ts": { buildHomePeriod, buildHomeReport },
    "./cached-member-avatars.ts": { resolveMemberAvatars: async (ids: string[]) => {
      calls.push({ table: "avatars", op: "resolve", args: [...ids] });
      return new Map(ids.map(id => [id, `/avatars/${id}.png`]));
    } },
  };
  vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in deps)) throw new Error(name); return deps[name]; } });
  return { calls, read: exports.getHomeData };
}

test("non-admin Home queries personal records and never reads or serializes teammate performance", async () => {
  for (const role of ["bd_manager", "operator", "viewer"]) {
    const mock = readerFixture(role), data = await mock.read();
    assert.equal(data.isAdmin, false);
    assert.equal(mock.calls.some(call => call.table === "workspace_members"), false);
    assert.equal(mock.calls.some(call => call.table === "avatars"), false);
    for (const table of ["companies", "emails", "purchase_orders"]) assert.ok(mock.calls.some(call => call.table === table && call.op === "eq" && call.args[1] === "alice"));
    assert.ok(Object.values(data.periods).every(period => period.team.length === 0));
    assert.equal(data.report.team.length, 0);
  }
});

test("custom reporting dates validate calendar dates and compare an equal inclusive period", () => {
  assert.deepEqual(resolveHomeRange({ from: "2026-11-01", to: "2026-11-09" }, "2026-11-09"), { from: "2026-11-01", to: "2026-11-09" });
  for (const range of [{ from: "2026-02-30", to: "2026-11-09" }, { from: "2026-11-09", to: "2026-11-08" }, { from: "2026-11-01", to: "2026-11-10" }, { from: "bad", to: "2026-11-09" }]) {
    assert.deepEqual(resolveHomeRange(range, "2026-11-09"), { from: "2026-11-09", to: "2026-11-09" });
  }
  assert.deepEqual(homePreviousRange({ from: "2026-11-01", to: "2026-11-09" }), { from: "2026-10-23", to: "2026-10-31" });
  assert.deepEqual(homePreviousRange({ from: "2024-03-01", to: "2024-03-01" }), { from: "2024-02-29", to: "2024-02-29" });
});

test("metric popups use real hourly counts in UTC+8, daily order dates and aligned comparisons", () => {
  const report = buildHomeReport(fixture(), undefined, now, true);
  assert.deepEqual(report.range, { from: "2026-11-09", to: "2026-11-09" });
  assert.equal(report.trends.emailsSent.length, 24);
  assert.equal(report.trends.emailsSent[0].current, 2);
  assert.equal(report.trends.emailsSent[23].previous, 1);
  assert.equal(report.trends.newCompanies[0].current, 1);
  assert.equal(report.trends.orders.length, 1);
  assert.equal(report.trends.orders[0].current, 2);
  assert.equal(report.trends.orders[0].previous, 1);
  assert.equal(report.previousMetrics.emailsSent, 1);
  assert.equal(report.metrics.orders, report.trends.orders.reduce((sum, row) => sum + row.current, 0));
  assert.equal(report.stages.find(row => row.stage === "won")?.count, 1);
  assert.equal(report.team.find(row => row.id === "alice")?.orders, 1);
});

test("long reporting ranges bound chart payloads without dropping current or previous counts", () => {
  const input = fixture();
  input.emails.push({ ownerId: "alice", sentAt: "2026-01-01T00:00:00Z" });
  input.emails.push({ ownerId: "alice", sentAt: "2025-12-01T00:00:00Z" });
  const report = buildHomeReport(input, { from: "2026-01-01", to: "2026-11-09" }, now, false);
  assert.ok(report.trends.emailsSent.length <= 60);
  assert.equal(report.trends.emailsSent.reduce((sum, point) => sum + point.current, 0), report.metrics.emailsSent);
  assert.equal(report.trends.emailsSent.reduce((sum, point) => sum + point.previous, 0), report.previousMetrics.emailsSent);
  assert.equal(report.team.length, 0);
});

test("admin Home loads active members; source failures and incomplete pages are reported", async () => {
  const mock = readerFixture("admin"), data = await mock.read();
  assert.equal(data.isAdmin, true);
  assert.equal(data.periods.all.team[0].name, "Alice");
  assert.equal(data.report.team[0].avatarUrl, "/avatars/alice.png");
  assert.deepEqual(mock.calls.find(call => call.table === "avatars")?.args, ["alice"]);
  assert.ok(mock.calls.some(call => call.table === "workspace_members" && call.op === "not" && call.args[0] === "activated_at"));
  assert.ok((await readerFixture("admin", "emails").read()).unavailable.includes("Sent emails"));
  const incomplete = await readerFixture("admin", undefined, true).read();
  assert.ok(incomplete.unavailable.includes("Customers"));
  assert.equal(incomplete.periods.all.metrics.newCompanies, 0, "partial source data discarded");
});

test("Sales and average order value use confirmed orders in one currency and preserve missing averages", () => {
  const report = buildHomeReport(fixture(), { from: "2026-11-08", to: "2026-11-09" }, now, true);
  assert.equal(report.sales.byCurrency.USD.current.sales, 15000);
  assert.equal(report.sales.byCurrency.USD.current.average, 7500);
  assert.equal(report.sales.byCurrency.EUR.current.sales, 20000);
  assert.equal(report.sales.byCurrency.EUR.current.average, 20000);
  assert.equal(report.sales.byCurrency.USD.previous.average, null);
  assert.equal(report.sales.byCurrency.USD.salesTrend.reduce((sum, row) => sum + (row.current ?? 0), 0), 15000);
  const usd = homeMetricValue(report, "sales", "USD"), eur = homeMetricValue(report, "averageOrderValue", "EUR");
  assert.equal(usd.current, 15000);
  assert.equal(eur.current, 20000);
  assert.equal(homeMetricValue(report, "sales", "invalid").current, 15000);
});

test("conversion counts unique new leads ordering in the period, excluding repeat orders and older accounts", () => {
  const input = fixture();
  input.companies.push({ id: "c", ownerId: "bob", stage: "new", createdAt: "2026-11-09T00:00:00+08:00" });
  input.orders.push(...[1000, 2000].map(totalMinor => ({ companyId: "b", date: "2026-11-09", status: "confirmed", currency: "USD", totalMinor })));
  const report = buildHomeReport(input, undefined, now, true);
  assert.equal(report.sales.conversion.current, 50, "one of two new leads converted despite two orders");
  assert.equal(report.sales.conversion.trend[0].current, 50);
  assert.equal(homeMetricValue(report, "conversionRate", "USD").current, 50);
  const empty = buildHomeReport({ companies: [], orders: [], emails: [], members: [] }, undefined, now, false);
  assert.equal(empty.sales.conversion.current, null);
  assert.equal(empty.sales.byCurrency.USD.current.sales, 0);
  assert.equal(empty.sales.byCurrency.USD.current.average, null);
});

test("four panel defaults are validated; choosing an existing metric swaps panels without duplicates", () => {
  assert.deepEqual(defaultHomeMetrics, ["newCompanies", "orders", "sales", "averageOrderValue"]);
  assert.deepEqual(replaceHomeMetric(defaultHomeMetrics, 3, "conversionRate"), ["newCompanies", "orders", "sales", "conversionRate"]);
  assert.deepEqual(replaceHomeMetric(defaultHomeMetrics, 0, "sales"), ["sales", "orders", "newCompanies", "averageOrderValue"]);
  assert.deepEqual(normalizeHomeMetrics(["sales", "sales", "orders", "emailsSent"]), defaultHomeMetrics);
  assert.deepEqual(normalizeHomeMetrics(["newCompanies", "orders", "unknown", "averageOrderValue"]), defaultHomeMetrics);
  assert.deepEqual(normalizeHomeMetrics(null), defaultHomeMetrics);
  assert.deepEqual(normalizeHomeMetrics(["orders", "conversionRate", "sales", "emailsSent"]), ["orders", "conversionRate", "sales", "emailsSent"]);
});
