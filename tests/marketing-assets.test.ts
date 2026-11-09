import assert from "node:assert/strict";
import test from "node:test";
import { holidaySlots, marketingAssetInputSchema, marketingAssetText, monthEndSlots, newMarketingAsset } from "../lib/marketing-assets.ts";

test("month-end campaigns include the final seven days, including leap years", () => {
  const slots = monthEndSlots(2028);
  assert.equal(slots.length, 12);
  assert.deepEqual(slots[1], { key: "month-2", title: "February promotion", startDate: "2028-02-23", endDate: "2028-02-29", month: 2 });
  assert.equal(monthEndSlots(2027)[1].startDate, "2027-02-22");
  assert.equal(slots[11].endDate, "2028-12-31");
});

test("holiday campaigns calculate floating U.S. retail dates across month boundaries", () => {
  const dates = new Map(holidaySlots(2026).map(slot => [slot.key, slot.startDate]));
  assert.equal(dates.get("thanksgiving"), "2026-11-26");
  assert.equal(dates.get("black-friday"), "2026-11-27");
  assert.equal(dates.get("cyber-monday"), "2026-11-30");
  assert.equal(dates.get("memorial-day"), "2026-05-25");
  assert.equal(dates.get("labor-day"), "2026-09-07");
  assert.equal(holidaySlots(2024).find(slot => slot.key === "cyber-monday")?.startDate, "2024-12-02");
});

test("plans reject impossible dates, reversed ranges, year mismatches and incomplete ready assets", () => {
  const draft = newMarketingAsset("month_end", 2026, monthEndSlots(2026)[0]);
  assert.equal(marketingAssetInputSchema.safeParse(draft).success, true);
  for (const change of [{ startDate: "2026-02-30" }, { endDate: "2026-01-01" }, { year: 2027 }, { title: " " }, { slot: "month-13" }, { status: "ready" }, { status: "ready", offer: "Special pricing", message: " " }]) {
    assert.equal(marketingAssetInputSchema.safeParse({ ...draft, ...change }).success, false, JSON.stringify(change));
  }
  const ready = marketingAssetInputSchema.parse({ ...draft, status: "ready", offer: "Special pricing", message: "Ask us for a quote.", productSkus: ["PLA", "PLA"] });
  assert.deepEqual(ready.productSkus, ["PLA"]);
});

test("new factory sales have independent slots and exports include all reusable content", () => {
  const first = newMarketingAsset("factory_sale", 2026), second = newMarketingAsset("factory_sale", 2026);
  assert.notEqual(first.slot, second.slot);
  const text = marketingAssetText({ ...first, title: "Partner sale", audience: "Distributors", productSkus: ["PLA", "OLD"], offer: "Bulk orders", message: "Request pricing" }, [{ sku: "PLA", name: "PLA filament", material: "PLA" }]);
  assert.match(text, /Partner sale/); assert.match(text, /Distributors/); assert.match(text, /PLA filament, OLD/); assert.match(text, /Bulk orders/); assert.match(text, /Request pricing/);
});
