import assert from "node:assert/strict";
import test from "node:test";
import { buildCreditActivity, creditActivityDate, creditActivityLevel, creditActivityWindow } from "../lib/profile-credit-activity.ts";

test("the activity window covers 12 calendar months with China midnight boundaries", () => {
  const window = creditActivityWindow(new Date("2026-11-28T03:00:00Z"));
  assert.deepEqual(window, { activityStart: "2025-11-30T16:00:00.000Z", monthStart: "2026-10-31T16:00:00.000Z", startDate: "2025-12-01", endDate: "2026-11-28" });
  assert.equal(creditActivityDate("2026-11-27T16:00:00Z"), "2026-11-28");
});

test("daily heatmaps align weekdays and months, include inactive days and omit future days", () => {
  const result = buildCreditActivity([{ date: "2026-11-01", usedMicros: 1000 }], "2026-11-01", "2026-11-10", "daily");
  assert.equal(result.cells.length, 10);
  assert.deepEqual(result.cells[0], { date: "2026-11-01", endDate: "2026-11-01", usedMicros: 1000, column: 1, row: 1 });
  assert.equal(result.cells[1].usedMicros, 0);
  assert.equal(result.cells[7].column, 2);
  assert.equal(result.cells[7].row, 1);
  assert.equal(result.columns, 2);
});

test("weekly and cumulative views derive accurate totals including partial weeks", () => {
  const days = [{ date: "2026-11-06", usedMicros: 1000 }, { date: "2026-11-07", usedMicros: 500 }, { date: "2026-11-08", usedMicros: 250 }];
  const weekly = buildCreditActivity(days, "2026-11-06", "2026-11-09", "weekly");
  assert.deepEqual(weekly.cells.map(cell => [cell.date, cell.endDate, cell.usedMicros]), [["2026-11-06", "2026-11-07", 1500], ["2026-11-08", "2026-11-09", 250]]);
  const cumulative = buildCreditActivity(days, "2026-11-06", "2026-11-09", "cumulative");
  assert.deepEqual(cumulative.cells.map(cell => cell.usedMicros), [1000, 1500, 1750, 1750]);
});

test("calendar layout survives leap years and month labels stay aligned", () => {
  const result = buildCreditActivity([], "2024-02-01", "2024-03-02", "daily");
  assert.equal(result.cells.length, 31);
  assert.equal(result.cells[28].date, "2024-02-29");
  assert.deepEqual(result.months, [{ date: "2024-02-01", column: 1 }, { date: "2024-03-01", column: 5 }]);
});

test("inactive activity stays neutral and fractional usage remains visible", () => {
  assert.equal(creditActivityLevel(0, 0), 0);
  assert.equal(creditActivityLevel(0, 10000), 0);
  assert.equal(creditActivityLevel(1, 10000), 1);
  assert.equal(creditActivityLevel(5000, 10000), 2);
  assert.equal(creditActivityLevel(10000, 10000), 4);
});
