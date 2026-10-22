import assert from "node:assert/strict";
import test from "node:test";
import { metaOrderLabel } from "../lib/order-estimate.ts";

const lead = (value: string, created_at = "2026-10-01") => ({ created_at, field_data: [{ name: "what_is_your_expected_initial_order_quantity?", values: [value] }] });

test("Meta estimates preserve ranges, qualifiers and uncertainty", () => {
  assert.equal(metaOrderLabel([lead("under_50_kg")], 50), "Under 50 kg");
  assert.equal(metaOrderLabel([lead("50–99_kg")], 50), "50–99 kg");
  assert.equal(metaOrderLabel([lead("500_kg_or_more")], 500), "500 kg or more");
  assert.equal(metaOrderLabel([lead("not_sure_yet")], null), "Not sure yet");
  assert.equal(metaOrderLabel([lead("1,000–1,999_kg")], 1000), "1,000–1,999 kg");
});

test("manual quantities win and latest submission is used without mutating input", () => {
  const leads = [lead("under_50_kg"), lead("100–499_kg", "2026-10-02")];
  assert.equal(metaOrderLabel(leads, 100), "100–499 kg");
  assert.equal(metaOrderLabel(leads, 250), null);
  assert.equal(leads[0].created_at, "2026-10-01");
});

test("missing and test answers do not become estimates", () => {
  assert.equal(metaOrderLabel([], null), null);
  assert.equal(metaOrderLabel([{ created_at: "", field_data: null }], null), null);
  assert.equal(metaOrderLabel([lead("<test lead: dummy data>")], null), null);
  assert.equal(metaOrderLabel([lead("")], null), null);
});
