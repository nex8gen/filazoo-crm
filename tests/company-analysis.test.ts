import assert from "node:assert/strict";
import test from "node:test";
import { analysisDaysAgo, analysisToday, companyAnalysisCsv, companyPurchaseAnalysis, type AnalysisOrder, type CompanyAnalysisData } from "../lib/company-analysis.ts";

const line = (quantity = 10, unitPriceMinor = 800) => ({ description: "PLA Basic · Black", sku: "PLA-BK", productSku: "PLA", variantId: "black", quantity, unitPriceMinor });
function order(id: string, date: string, input: Partial<AnalysisOrder> = {}): AnalysisOrder {
  return { id, reference: `PO-${id}`, orderDate: date, deliveryDate: "", currency: "USD", status: "completed", items: [line()], ...input };
}
function source(orders: AnalysisOrder[]): CompanyAnalysisData {
  return { orders, products: [{ sku: "PLA", name: "PLA Basic" }], tasks: [], asOf: "2026-10-27T02:00:00Z" };
}
const all = { from: "", to: "2026-10-27" };

test("purchase totals use line amounts, inclusive order dates and effective statuses within one currency", () => {
  const result = companyPurchaseAnalysis(source([
    order("1", "2026-09-01", { status: "confirmed", items: [line(200, 800)] }),
    order("2", "2026-10-27", { status: "shipped", items: [line(100, 1000)] }),
    order("3", "2026-08-31"), order("4", "2026-10-10", { status: "draft" }),
    order("5", "2026-10-10", { status: "cancelled" }), order("6", "2026-10-10", { currency: "EUR" }),
    order("7", "2026-11-01"),
  ]), "USD", { from: "2026-09-01", to: "2026-10-27" });
  assert.equal(result.orderCount, 2);
  assert.equal(result.amountMinor, 260000);
  assert.equal(result.quantity, 300);
  assert.equal(result.averageMinor, 130000);
  assert.equal(result.products[0].name, "PLA Basic");
  assert.equal(result.products[0].share, 1);
  assert.equal(result.latest?.id, "2");
});

test("trend includes zero months and product percentages reconcile to GMV", () => {
  const result = companyPurchaseAnalysis(source([
    order("1", "2026-07-15", { items: [line(10, 800)] }),
    order("2", "2026-09-01", { items: [line(10, 800), { ...line(5, 1600), productSku: "SILK", description: "PLA Silk" }] }),
  ]), "USD", { from: "2026-07-01", to: "2026-10-27" });
  assert.deepEqual(result.months.map(month => month.amountMinor), [8000, 0, 16000, 0]);
  assert.equal(result.products.reduce((sum, product) => sum + product.amountMinor, 0), result.amountMinor);
  assert.equal(result.products.reduce((sum, product) => sum + product.share, 0), 1);
  assert.equal(result.peak?.month, "2026-09");
});

test("reminders use complete history, consolidate repeated lines, and give shipped orders receipt follow-ups", () => {
  const result = companyPurchaseAnalysis(source([
    order("1", "2026-05-01"), order("2", "2026-07-01"),
    order("3", "2026-09-01", { items: [line(10), line(20)] }),
    order("4", "2026-10-08", { status: "shipped", items: [{ ...line(260), sku: "SILK-GD", productSku: "SILK", variantId: "gold", description: "PLA Silk · Gold" }] }),
  ]), "USD", { from: "2026-10-01", to: "2026-10-27" });
  assert.equal(result.orderCount, 1);
  assert.equal(result.reminders.length, 2);
  assert.equal(result.reminders[0].kind, "receipt");
  const basic = result.reminders[1];
  assert.equal(basic.lastQuantity, 30);
  assert.equal(basic.orderCount, 3);
  assert.equal(basic.averageGap, 62);
  assert.equal(basic.daysSince, 56);
  assert.equal(basic.kind, "monitor");
});

test("unstable intervals and sparse history never imply a fixed replenishment date", () => {
  const unstable = companyPurchaseAnalysis(source([order("1", "2026-01-01"), order("2", "2026-01-02"), order("3", "2026-09-01")]), "USD", all);
  assert.equal(unstable.reminders[0].kind, "demand");
  const sparse = companyPurchaseAnalysis(source([order("1", "2026-01-01"), order("2", "2026-02-01")]), "USD", all);
  assert.equal(sparse.reminders[0].kind, "history");
  assert.equal(sparse.reminders[0].averageGap, null);
  const split = companyPurchaseAnalysis(source([order("1", "2026-01-01"), order("2", "2026-01-01"), order("3", "2026-02-01")]), "USD", all);
  assert.equal(split.reminders[0].kind, "history");
});

test("stable elapsed cycles suggest checking restock; active fulfillment takes priority", () => {
  const result = companyPurchaseAnalysis(source([order("1", "2026-05-01"), order("2", "2026-06-01"), order("3", "2026-07-01")]), "USD", all);
  assert.equal(result.reminders[0].kind, "restock");
  const active = companyPurchaseAnalysis(source([order("1", "2026-10-01", { status: "in_production" })]), "USD", all);
  assert.equal(active.reminders[0].kind, "fulfillment");
});

test("empty periods show zero metrics but retain historical latest order and reminders", () => {
  const result = companyPurchaseAnalysis(source([order("1", "2026-01-01")]), "USD", { from: "2026-10-01", to: "2026-10-27" });
  assert.equal(result.amountMinor, 0);
  assert.equal(result.averageMinor, 0);
  assert.equal(result.peak, null);
  assert.equal(result.products.length, 0);
  assert.equal(result.latest?.id, "1");
  assert.equal(result.reminders.length, 1);
});

test("date windows use China calendar dates with inclusive 90 and 180 day periods", () => {
  assert.equal(analysisToday(new Date("2026-10-26T16:01:00Z")), "2026-10-27");
  assert.equal(analysisDaysAgo("2026-10-27", 89), "2026-07-30");
  assert.equal(analysisDaysAgo("2026-10-27", 179), "2026-05-01");
});

test("CSV preserves line amounts, quotes customer text and neutralizes spreadsheet formulas", () => {
  const csv = companyAnalysisCsv([order("1", "2026-10-27", { reference: '=HYPERLINK("evil")', items: [{ ...line(3, 123), description: "Product, \"Black\"" }] })]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"Product, ""Black"""'));
  assert.ok(csv.includes('"3","1.23","3.69"'));
});
