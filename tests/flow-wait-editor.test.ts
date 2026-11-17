import assert from "node:assert/strict";
import test from "node:test";
import { applyWaitDraft, waitDraftChanged, waitEditorDraft, waitSummary, waitUnits } from "../lib/flow-wait-editor.ts";
import { calculateWaitUntil } from "../lib/flow-engine.ts";
import { defaultFlowInput, flowInputSchema } from "../lib/flows.ts";

test("time delay editor accepts supported units and schema limits", () => {
  for (const unit of waitUnits) for (const amount of [1, 525600]) {
    const result = applyWaitDraft({}, { ...waitEditorDraft({}), amount: String(amount), unit });
    assert.ok(result.ok);
    assert.ok(flowInputSchema.safeParse({ ...defaultFlowInput, steps: [{ id: "wait", type: "wait", config: result.config }] }).success);
  }
  for (const amount of ["", "0", "-1", "1.5", "525601", "Infinity"]) {
    assert.equal(applyWaitDraft({}, { ...waitEditorDraft({}), amount }).ok, false, amount);
  }
  assert.equal(applyWaitDraft({}, { ...waitEditorDraft({}), unit: "weeks" }).ok, false);
  assert.equal(applyWaitDraft({}, { ...waitEditorDraft({}), specificTime: true, resumeAt: "24:00" }).ok, false);
});

test("optional scheduling preserves config and clears a disabled resume time", () => {
  const config = { amount: 2, unit: "hours", resumeAt: "14:30", businessDays: true, custom: "preserve" };
  const draft = waitEditorDraft(config);
  assert.equal(waitDraftChanged(config, draft), false);
  const result = applyWaitDraft(config, { ...draft, specificTime: false });
  assert.ok(result.ok);
  assert.deepEqual(result.config, { ...config, resumeAt: "" });
  assert.equal(config.resumeAt, "14:30");
  assert.equal(waitDraftChanged({}, { ...waitEditorDraft({}), resumeAt: "12:00" }), false);
});

test("saved scheduling options follow the existing UTC and weekday rules", () => {
  const result = applyWaitDraft({}, { ...waitEditorDraft({}), amount: "1", unit: "days", businessDays: true, specificTime: true, resumeAt: "14:30" });
  assert.ok(result.ok);
  assert.equal(calculateWaitUntil(result.config, new Date("2026-11-13T10:00:00Z")).toISOString(), "2026-11-16T14:30:00.000Z");
  assert.equal(waitSummary(result.config), "Wait 1 business day · 14:30 UTC");
  assert.equal(waitSummary({ amount: 2, unit: "hours", businessDays: true }), "Wait 2 hours · skip weekends");
  assert.equal(waitSummary({ amount: 1, unit: "minutes" }), "Wait 1 minute");
});
