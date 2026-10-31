import assert from "node:assert/strict";
import test from "node:test";
import { createSegmentFlowDraft, isSegmentAudienceFlow, segmentCompaniesHref, segmentFlowHref } from "../lib/segment-flows.ts";
import { blankStep, flowInputSchema } from "../lib/flows.ts";
import { matchesProfileFilters, triggerMatches, type FlowFacts } from "../lib/flow-engine.ts";

const id = "a1111111-1111-4111-8111-111111111111";
const facts: FlowFacts = { customerReplied: false, openedEmail: false, clickedLink: false, category: null, segment: "Wholesale", country: "US", companyStatus: "new", pipelineStage: null, fitScore: 8 };

test("segment links encode names and distinguish saved IDs from business segments", () => {
  for (const kind of ["saved", "business"]) {
    const segment = { id, kind, name: "US / EU & B2B + 新客户" };
    const url = new URL(segmentFlowHref(segment), "http://localhost");
    assert.equal(url.pathname, "/workflow");
    assert.deepEqual([...url.searchParams], [[kind === "saved" ? "segmentId" : "segment", kind === "saved" ? id : segment.name]]);
  }
});

test("segment drafts open with only their trigger and accept custom actions before saving", () => {
  for (const kind of ["saved", "business"]) {
    const draft = createSegmentFlowDraft({ id, name: "Wholesale", kind });
    assert.equal(draft.status, "draft");
    assert.equal(draft.triggerType, "company_segment_changed");
    assert.equal(draft.triggerConfig.segment, "Wholesale");
    assert.deepEqual(draft.steps, []);
    assert.equal(flowInputSchema.safeParse(draft).success, false);
    const saved = flowInputSchema.parse({ ...draft, steps: [blankStep("create_task")] });
    assert.equal(saved.triggerConfig.savedSegmentId, kind === "saved" ? id : undefined);
    const reopened = flowInputSchema.parse(JSON.parse(JSON.stringify(saved)));
    assert.equal(reopened.triggerConfig.segmentAudience, true);
    assert.equal(isSegmentAudienceFlow(reopened.triggerType, reopened.triggerConfig), true);
    const audience = new URL(segmentCompaniesHref(reopened.triggerConfig), "http://localhost");
    assert.equal(audience.searchParams.get(kind === "saved" ? "segmentId" : "segment"), kind === "saved" ? id : "Wholesale");
  }
});

test("general flow triggers stay configurable while historical segment launches have a fixed audience", () => {
  assert.equal(isSegmentAudienceFlow("company_segment_changed", { segment: "Historical email lead" }), false);
  assert.equal(isSegmentAudienceFlow("company_segment_changed", createSegmentFlowDraft({ id: "", name: "Historical email lead", kind: "business" }).triggerConfig), true);
  assert.equal(isSegmentAudienceFlow("email_received", { segment: "Historical email lead" }), false);
});

test("saved-segment matching uses verified current membership instead of a matching business name", () => {
  const config = createSegmentFlowDraft({ id, name: "Wholesale", kind: "saved" }).triggerConfig;
  const event = { type: "company_segment_changed", conversationId: "company:test", segment: "Wholesale" } as const;
  assert.equal(triggerMatches(event.type, config, event, facts), false);
  assert.equal(triggerMatches(event.type, config, event, { ...facts, savedSegmentIds: [] }), false);
  assert.equal(triggerMatches(event.type, config, event, { ...facts, segment: "Retail", savedSegmentIds: [id] }), true);
  assert.equal(matchesProfileFilters({ ...config, country: "GB" }, { ...facts, savedSegmentIds: [id] }), false);
  assert.equal(matchesProfileFilters({ ...config, savedSegmentId: "bad" }, facts), false);
});

test("saved company membership triggers require no re-entry and a valid segment reference", () => {
  const draft = { ...createSegmentFlowDraft({ id, name: "Priority", kind: "saved" }), steps: [blankStep("create_task")] };
  for (const patch of [{ savedSegmentId: "bad" }, { reentryMode: "every_event" }, { reentryMode: "after_period", reentryAfterAmount: 1, reentryAfterUnit: "days" }]) {
    assert.equal(flowInputSchema.safeParse({ ...draft, triggerConfig: { ...draft.triggerConfig, ...patch } }).success, false);
  }
});
