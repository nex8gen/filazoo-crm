import assert from "node:assert/strict";
import test from "node:test";
import { companyListAnalytics } from "../lib/company-list-analytics.ts";
import type { Company } from "../lib/types.ts";

const asOf = "2026-11-20T04:00:00Z";
const company = (addedAt: string, overrides: Partial<Company> = {}) => ({ addedAt, customerTags: [], outreachStatus: "Not started", paidOrderCount: 0, ...overrides });

test("compares equal acquisition windows and excludes invalid, old, and future records", () => {
  const metrics = companyListAnalytics([
    company("2026-11-20T04:00:00Z"), company("2026-11-13T04:00:00Z"),
    company("2026-11-13T03:59:59Z"), company("2026-11-06T04:00:00Z"),
    company("2026-11-06T03:59:59Z"), company("2026-11-20T04:00:01Z"), company("invalid"),
  ], 7, asOf);
  assert.equal(metrics[0].value, 2);
  assert.equal(metrics[0].change, 0);
  assert.equal(metrics[0].points.reduce((sum, count) => sum + count), 2);
  assert.equal(metrics[0].previousPoints.reduce((sum, count) => sum + count), 2);
});

test("counts companies once across overlapping tags and uses customers for conversion", () => {
  const metrics = companyListAnalytics([
    company("2026-11-19T04:00:00Z", { customerTags: ["Customer replied", "New Inquiries", "Quotation Follow-up"], outreachStatus: "Email replied", paidOrderCount: 4 }),
    company("2026-11-18T04:00:00Z", { outreachStatus: "Email sent" }),
    company("2026-11-17T04:00:00Z"), company("2026-11-16T04:00:00Z"),
  ], 7, asOf);
  assert.deepEqual(metrics.map(metric => metric.value), [4, 2, 1, 1, 1, 25]);
  assert.ok(metrics.every(metric => metric.change === null));
});

test("empty filtered lists stay finite and longer date ranges include older companies", () => {
  assert.ok(companyListAnalytics([], 7, asOf).every(metric => metric.value === 0 && metric.change === null));
  const rows = [company("2026-11-01T04:00:00Z")];
  assert.equal(companyListAnalytics(rows, 7, asOf)[0].value, 0);
  assert.equal(companyListAnalytics(rows, 30, asOf)[0].value, 1);
});
