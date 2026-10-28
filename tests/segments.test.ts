import assert from "node:assert/strict";
import test from "node:test";
import { matchesSegment, segmentInputSchema, segmentRulesSchema, summarizeSegment, type SegmentCompany } from "../lib/segments.ts";
import { pipelineStageLabels } from "../lib/types.ts";

const company: SegmentCompany = { id: "one", name: "Example", segment: "Wholesale", country: "United States", source: "manual", sourceLabel: "Manual", stage: pipelineStageLabels.interested, fitScore: 8, hasEmail: true };

test("saved audiences require every selected rule and use an inclusive fit threshold", () => {
  const rules = { businessSegment: "Wholesale", country: "United States", source: "manual", stage: "interested", minFitScore: 8, hasEmail: true } as const;
  assert.equal(matchesSegment(company, rules), true);
  for (const change of [{ segment: "Retail" }, { country: "Canada" }, { source: "shopify_lead" }, { stage: pipelineStageLabels.won }, { fitScore: 7 }, { hasEmail: false }]) {
    assert.equal(matchesSegment({ ...company, ...change }, rules), false, JSON.stringify(change));
  }
  assert.equal(matchesSegment({ ...company, fitScore: 0 }, { minFitScore: 1 }), false);
});

test("missing-email audiences respect false; empty rules include everyone; membership updates with profiles", () => {
  assert.equal(matchesSegment(company, {}), true);
  assert.equal(matchesSegment(company, { hasEmail: false }), false);
  assert.equal(matchesSegment({ ...company, hasEmail: false }, { hasEmail: false }), true);
  assert.equal(matchesSegment(company, { stage: "won" }), false);
  assert.equal(matchesSegment({ ...company, stage: pipelineStageLabels.won }, { stage: "won" }), true);
  assert.equal(matchesSegment(company, { country: "United" }), false);
});

test("manual audiences contain only selected IDs even when company profiles change", () => {
  const id = "a1111111-1111-4111-8111-111111111111";
  const rules = segmentRulesSchema.parse({ companyIds: [id] });
  assert.equal(matchesSegment({ ...company, id }, rules), true);
  assert.equal(matchesSegment({ ...company, id, country: "Canada", fitScore: 0, stage: pipelineStageLabels.lost }, rules), true);
  assert.equal(matchesSegment(company, rules), false);
  assert.equal(matchesSegment(company, { companyIds: [] }), false);
  for (const input of [{ companyIds: [] }, { companyIds: ["invalid"] }, { companyIds: [id], country: "Canada" }]) assert.equal(segmentRulesSchema.safeParse(input).success, false);
});

test("segment rules reject unknown fields and invalid values instead of silently widening an audience", () => {
  for (const rules of [{ country: "" }, { country: " ", hasEmail: true }, { stage: "interested OR true" }, { minFitScore: 0 }, { minFitScore: 11 }, { minFitScore: 1.5 }, { hasEmail: "false" }, { ownerId: "forged" }, null, []]) {
    assert.equal(segmentRulesSchema.safeParse(rules).success, false, JSON.stringify(rules));
  }
  assert.equal(segmentInputSchema.safeParse({ name: " ", description: "", rules: {} }).success, false);
  assert.equal(segmentInputSchema.safeParse({ name: "x".repeat(121), description: "", rules: {} }).success, false);
  assert.deepEqual(segmentInputSchema.parse({ name: "  Prospects  ", description: "  Description  ", rules: {} }), { name: "Prospects", description: "Description", rules: {} });
});

test("analytics exclude unrated scores and unknown markets and keep won/lost out of active counts", () => {
  const summary = summarizeSegment([company, { ...company, id: "two", fitScore: 0, country: "Unknown", hasEmail: false, stage: pipelineStageLabels.won }, { ...company, id: "three", fitScore: 4, country: "Canada", stage: pipelineStageLabels.lost }]);
  assert.equal(summary.count, 3);
  assert.equal(summary.withEmail, 2);
  assert.equal(summary.countries, 2);
  assert.equal(summary.averageFit, 6);
  assert.equal(summary.won, 1);
  assert.equal(summary.active, 1);
  assert.equal(summary.stages.reduce((sum, stage) => sum + stage.count, 0), 3);
  const empty = summarizeSegment([]);
  assert.equal(empty.averageFit, null);
  assert.equal(empty.count, 0);
  assert.equal(empty.countries, 0);
});
