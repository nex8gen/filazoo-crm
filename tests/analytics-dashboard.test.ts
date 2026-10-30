import assert from "node:assert/strict";
import test from "node:test";

import { analyticsChannelForSource, analyticsChange, analyticsCsv, analyticsDay, computeAnalytics, previousRange, type AnalyticsDashboardData, type AnalyticsFiltersValue } from "../lib/analytics-dashboard.ts";

test("maps real CRM acquisition sources into dashboard channels", () => {
  assert.equal(analyticsChannelForSource("shopify_b2b_form"), "store");
  assert.equal(analyticsChannelForSource("facebook_lead_ad"), "meta");
  assert.equal(analyticsChannelForSource("wholesale_referral"), "partner");
  assert.equal(analyticsChannelForSource(null), "other");
  assert.equal(analyticsChannelForSource("historical_email"), "direct");
  assert.equal(analyticsChannelForSource("manual"), "direct");
  assert.equal(analyticsChannelForSource("shopify_b2b_form+meta_lead_ads"), "mixed");
});

const filters: AnalyticsFiltersValue = { from: "2026-10-01", to: "2026-10-30", channel: "all", owner: "all", currency: "USD", comparison: "previous_period" };
function fixture(): AnalyticsDashboardData {
  return {
    asOf: "2026-10-30T04:00:00Z", minDate: "2026-01-01", maxDate: "2026-10-30", currencies: ["USD", "EUR"], sources: [], owners: [],
    companies: [
      { id: "old", name: "Old open", createdAt: "2026-01-01T10:00:00Z", channel: "meta", ownerId: "alice", nextFollowupAt: "2026-10-29T09:00:00Z" },
      { id: "new", name: "New won", createdAt: "2026-10-20T10:00:00Z", channel: "store", ownerId: "bob", nextFollowupAt: null },
      { id: "lost", name: "Lost", createdAt: "2026-10-21T10:00:00Z", channel: "meta", ownerId: null, nextFollowupAt: null },
      { id: "eur", name: "Euro", createdAt: "2026-10-22T10:00:00Z", channel: "meta", ownerId: "alice", nextFollowupAt: null },
    ],
    invoices: [
      { id: "old-invoice", companyId: "old", number: 1, status: "issued", currency: "USD", issueDate: "2026-09-01", dueDate: "2026-09-15", totalMinor: 10000, paidMinor: 3000 },
      { id: "new-invoice", companyId: "new", number: 2, status: "issued", currency: "USD", issueDate: "2026-10-01", dueDate: "2026-10-30", totalMinor: 20000, paidMinor: 0 },
      { id: "draft", companyId: "new", number: 3, status: "draft", currency: "USD", issueDate: "2026-10-01", dueDate: "2026-10-15", totalMinor: 99900, paidMinor: 0 },
      { id: "void", companyId: "new", number: 4, status: "void", currency: "USD", issueDate: "2026-10-01", dueDate: "2026-10-15", totalMinor: 99900, paidMinor: 0 },
      { id: "eur-invoice", companyId: "eur", number: 5, status: "issued", currency: "EUR", issueDate: "2026-10-01", dueDate: "2026-10-15", totalMinor: 50000, paidMinor: 0 },
    ],
    payments: [{ id: "p1", invoiceId: "old-invoice", paidOn: "2026-10-10", amountMinor: 3000 }, { id: "bad", invoiceId: "void", paidOn: "2026-10-10", amountMinor: 500 }],
    orders: [{ id: "o1", companyId: "old", date: "2026-10-01", currency: "USD", status: "confirmed", totalMinor: 11000 }, { id: "o2", companyId: "new", date: "2026-10-01", currency: "USD", status: "cancelled", totalMinor: 99999 }],
    catalogs: [{ id: "c1", companyId: "old", createdAt: "2026-10-01T08:00:00Z", currency: "EUR", productSkus: ["sku", "sku"] }],
    products: [{ sku: "sku", name: "Product" }], emails: [], messages: [], ai: [],
    tasks: [{ id: "task", title: "Overdue", companyId: "new", status: "open", dueAt: "2026-10-29T00:00:00Z", completedAt: null }],
    flows: [], runs: [], inventory: { configured: false, stale: false, lastSyncedAt: null, error: false, tracked: 0, unavailable: 0 },
  };
}
test("receivables are current snapshots; activity uses its own event dates", () => {
  const result = computeAnalytics(fixture(), filters);
  assert.equal(result.current.newCompanies, 3, "company counts are independent of currency");
  assert.equal(result.current.invoiced, 20000, "drafts, voids and other currencies excluded");
  assert.equal(result.current.collected, 3000, "payment of older invoice is counted by payment date");
  assert.equal(result.outstanding, 27000, "older unpaid invoices remain in the balance");
  assert.equal(result.overdue, 7000, "invoice due today is not yet overdue");
  assert.equal(result.current.orderValue, 11000);
  assert.equal(result.series.reduce((sum, point) => sum + point.collected, 0), 30);
});
test("source and owner scopes follow company links without currency filtering headcounts", () => {
  const result = computeAnalytics(fixture(), { ...filters, channel: "meta", owner: "alice" });
  assert.equal(result.current.newCompanies, 1);
  assert.equal(result.current.collected, 3000);
  assert.equal(result.current.invoiced, 0);
  assert.equal(result.current.orderValue, 11000);
  assert.equal(result.overdueTasks.length, 1, "personal tasks are independent of company filters");
});
test("catalogs use their own currency and each SKU counts once per catalog", () => {
  assert.equal(computeAnalytics(fixture(), filters).topProducts.length, 0);
  const result = computeAnalytics(fixture(), { ...filters, currency: "EUR" });
  assert.deepEqual(result.topProducts, [{ sku: "sku", name: "Product", count: 1 }]);
});
test("timezone boundaries, equal comparison windows, and leap days are deterministic", () => {
  assert.equal(analyticsDay("2026-09-30T16:00:00Z"), "2026-10-01");
  assert.equal(analyticsDay("2026-10-01T00:00:00+08:00"), "2026-10-01");
  assert.deepEqual(previousRange(filters), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(previousRange({ from: "2024-02-29", to: "2024-02-29", comparison: "previous_year" }), { from: "2023-02-28", to: "2023-02-28" });
  assert.equal(analyticsChange(10, 0), null);
  assert.equal(analyticsChange(0, 0), 0);
});
test("large windows have bounded chart points and preserve all totals", () => {
  const result = computeAnalytics(fixture(), { ...filters, from: "2000-01-01" });
  assert.ok(result.series.length <= 90);
  assert.equal(result.series.reduce((total, point) => total + point.companies, 0), 4);
  assert.equal(result.series.reduce((total, point) => total + point.collected, 0), 30);
});
test("CSV safely quotes content and neutralizes spreadsheet formulas", () => {
  const csv = analyticsCsv([["=1+1", 'Name, "quoted"', 12]]);
  assert.equal(csv, '\uFEFF"\'=1+1","Name, ""quoted""","12"');
});
