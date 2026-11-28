import assert from "node:assert/strict";
import test from "node:test";
import { businessHoursSchema, defaultBusinessHours, isTimeZone, nextWorkspaceBusinessWindow, workspaceWebsiteSchema } from "../lib/workspace-settings.ts";
import { nextBusinessWindow, simulateFlow } from "../lib/flow-engine.ts";
import { defaultFlowInput, flowInputSchema, blankStep } from "../lib/flows.ts";
import { flowScenarioSchema } from "../lib/flow-email-test.ts";
import { analyticsDay, computeAnalytics, type AnalyticsDashboardData } from "../lib/analytics-dashboard.ts";
import { buildHomeReport } from "../lib/home.ts";

const windowAt = (now: string, timezone: string, hours = defaultBusinessHours) => nextWorkspaceBusinessWindow(new Date(now), timezone, hours)?.toISOString() ?? null;

test("workspace URLs reject script schemes and credentials and normalize bare domains", () => {
  assert.equal(workspaceWebsiteSchema.parse(" example.com "), "https://example.com");
  assert.equal(workspaceWebsiteSchema.parse(""), "");
  for (const value of ["javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "https://user:secret@example.com", "not a website"]) assert.equal(workspaceWebsiteSchema.safeParse(value).success, false, value);
});

test("schedules require a real timezone, working days and same-day opening hours", () => {
  assert.equal(isTimeZone("Asia/Kathmandu"), true);
  assert.equal(isTimeZone("Not/A_Timezone"), false);
  for (const hours of [{ ...defaultBusinessHours, days: [] }, { ...defaultBusinessHours, days: [8] }, { ...defaultBusinessHours, start: "17:00", end: "09:00" }, { ...defaultBusinessHours, end: "25:00" }, { ...defaultBusinessHours, end: "09:00" }]) assert.equal(businessHoursSchema.safeParse(hours).success, false);
  assert.deepEqual(businessHoursSchema.parse({ ...defaultBusinessHours, days: [5, 1, 1] }).days, [1, 5]);
});

test("business hours respect opening, exclusive closing, weekends and selected weekdays", () => {
  assert.equal(windowAt("2026-11-27T00:59:50Z", "Asia/Shanghai"), "2026-11-27T01:00:00.000Z");
  assert.equal(windowAt("2026-11-27T01:00:00Z", "Asia/Shanghai"), null);
  assert.equal(windowAt("2026-11-27T08:59:59Z", "Asia/Shanghai"), null);
  assert.equal(windowAt("2026-11-27T09:00:00Z", "Asia/Shanghai"), "2026-11-30T01:00:00.000Z");
  assert.equal(windowAt("2026-11-27T09:00:00Z", "Asia/Shanghai", { days: [0], start: "10:30", end: "14:00" }), "2026-11-29T02:30:00.000Z");
  assert.equal(windowAt("2026-11-27T00:00:00Z", "Asia/Kathmandu", { ...defaultBusinessHours, start: "09:15" }), "2026-11-27T03:30:00.000Z");
});

test("DST advances and repeated hours resolve to the next actual open instant", () => {
  assert.equal(windowAt("2026-03-06T22:00:00Z", "America/New_York"), "2026-03-09T13:00:00.000Z");
  assert.equal(windowAt("2026-10-30T21:00:00Z", "America/New_York"), "2026-11-02T14:00:00.000Z");
  assert.equal(windowAt("2026-03-08T06:00:00Z", "America/New_York", { days: [0], start: "02:30", end: "04:00" }), "2026-03-08T07:00:00.000Z");
  assert.equal(windowAt("2026-11-01T05:45:00Z", "America/New_York", { days: [0], start: "01:00", end: "01:30" }), "2026-11-01T06:00:00.000Z");
});

test("workflow simulation and live business-window checks use the same schedule", () => {
  const schedule = { timezone: "Asia/Shanghai", businessHours: { days: [1], start: "10:00", end: "18:00" } };
  const now = new Date("2026-11-27T12:00:00Z");
  const step = blankStep("ai_auto_reply"); step.config.sendWindow = "business_hours";
  const flow = flowInputSchema.parse({ ...defaultFlowInput, steps: [step] });
  const result = simulateFlow(flow, flowScenarioSchema.parse({}), now, { schedule });
  assert.equal(result.trace[0].scheduledAt, nextBusinessWindow(now, schedule)?.toISOString());
  assert.equal(result.trace[0].scheduledAt, "2026-11-30T02:00:00.000Z");
});

test("workspace timezone changes report dates and hourly buckets without shifting date-only orders", () => {
  const instant = "2026-11-28T01:00:00Z", timezone = "America/Los_Angeles";
  assert.equal(analyticsDay(instant, timezone), "2026-11-27");
  assert.equal(analyticsDay("2026-11-28", timezone), "2026-11-28");
  const home = buildHomeReport({ timezone, companies: [{ id: "a", ownerId: null, stage: "new", createdAt: instant }], emails: [{ ownerId: null, sentAt: instant }], orders: [], members: [] }, undefined, new Date(instant), false);
  assert.equal(home.range.to, "2026-11-27");
  assert.equal(home.trends.emailsSent[17].current, 1);
  assert.equal(home.trends.emailsSent[17].available, true);
  assert.equal(home.trends.emailsSent[18].available, false);
  const data: AnalyticsDashboardData = { timezone, companies: [{ id: "a", name: "A", createdAt: instant, channel: "direct", ownerId: null }], invoices: [], payments: [], orders: [], catalogs: [], products: [], currencies: ["USD"], sources: [], owners: [], minDate: "2026-11-27", maxDate: "2026-11-27", asOf: instant };
  const report = computeAnalytics(data, { from: "2026-11-27", to: "2026-11-27", channel: "all", owner: "all", currency: "USD", comparison: "none" });
  assert.ok(JSON.stringify(report).includes('"newCompanies":1'));
});
