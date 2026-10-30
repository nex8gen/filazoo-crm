import assert from "node:assert/strict";
import test from "node:test";
import { hasRetiredSalesConfig } from "../lib/retired-sales.ts";
import { defaultFlowInput, flowInputSchema, flowAgentCapabilities, blankStep } from "../lib/flows.ts";
import { companyProfileChangesSchema } from "../lib/company-profile-fields.ts";
import { matchesSegment, segmentInputSchema } from "../lib/segments.ts";
import { companyExportColumns } from "../lib/company-export.ts";

test("retired sales updates are rejected by customer and AI profile validation", () => {
  for (const changes of [{ stage: "won" }, { estimatedValue: 1200 }, { estimatedOrderQuantity: 50 }, { currency: "USD" }]) {
    assert.equal(companyProfileChangesSchema.safeParse(changes).success, false);
  }
  assert.equal(companyProfileChangesSchema.safeParse({ nextFollowupAt: "2026-11-01T09:00:00Z", commerce: { currency: "USD" } }).success, true);
  assert.ok(!companyExportColumns.includes("Stage"));
});
test("sales-dependent trigger, action, filter and nested branch definitions cannot be activated", () => {
  for (const definition of [
    { ...defaultFlowInput, triggerType: "pipeline_stage_changed", triggerConfig: { stage: "new" } },
    { ...defaultFlowInput, triggerConfig: { ...defaultFlowInput.triggerConfig, pipelineStage: "interested" } },
    { ...defaultFlowInput, steps: [{ type: "update_company", config: { pipelineStage: "won" } }] },
    { ...defaultFlowInput, steps: [{ type: "if_condition", config: { field: "pipeline_stage_is", pipelineStage: "won", action: "continue" } }] },
  ]) assert.equal(flowInputSchema.safeParse(definition).success, false);
  assert.equal(hasRetiredSalesConfig({ paths: [{ steps: [{ config: { pipelineStage: "won" } }] }] }), true);
  assert.equal(flowInputSchema.safeParse({ ...defaultFlowInput, steps: [blankStep("update_company")] }).success, true);
});
test("AI automation capabilities do not advertise removed sales controls", () => {
  assert.doesNotMatch(JSON.stringify(flowAgentCapabilities()), /pipelineStage|pipeline_stage_is|pipeline_stage_changed/);
});
test("existing sales-based segments stay closed until explicitly rebuilt", () => {
  const company = { id: "one", name: "Company", segment: "Retail", country: "US", source: "manual", sourceLabel: "Manual", fitScore: 7, hasEmail: true };
  assert.equal(matchesSegment(company, { stage: "interested", country: "US" }), false);
  assert.equal(segmentInputSchema.safeParse({ name: "Saved audience", description: "", rules: { stage: "interested" } }).success, false);
  assert.equal(matchesSegment(company, { country: "US" }), true);
});
