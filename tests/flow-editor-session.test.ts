import assert from "node:assert/strict";
import test from "node:test";
import { flowEditorChanged, flowEditorEqual, flowEditorSnapshot, restoreFlowEditor } from "../lib/flow-editor-session.ts";
import { blankStep, defaultFlowInput, type FlowInput, type JsonConfig } from "../lib/flows.ts";
import { editFlowSiblings, flowActionLocations } from "../lib/flow-tree.ts";

test("database key order does not create phantom unsaved edits", () => {
  assert.ok(flowEditorEqual({ amount: 1, nested: { a: true, b: [1, 2] } }, { nested: { b: [1, 2], a: true }, amount: 1 }));
  assert.equal(flowEditorEqual({ steps: [1, 2] }, { steps: [2, 1] }), false);
  const original = structuredClone(defaultFlowInput);
  const snapshot = flowEditorSnapshot(original, "trigger");
  original.triggerConfig = Object.fromEntries(Object.entries(original.triggerConfig).reverse()) as JsonConfig;
  assert.equal(flowEditorChanged(original, snapshot), false);
});

test("discarding a nested action preserves other action edits, order, and workflow name", () => {
  const child = { ...blankStep("wait"), config: { amount: 1, unit: "hours" } };
  const sibling = blankStep("stop");
  const split = { ...blankStep("split"), config: { paths: [{ id: "one", name: "Matches", condition: { field: "customer_replied" }, steps: [child] }, { id: "two", name: "Everyone else", condition: null, steps: [sibling] }] } as unknown as JsonConfig };
  const original: FlowInput = { ...structuredClone(defaultFlowInput), steps: [split, blankStep("wait")] };
  const snapshot = flowEditorSnapshot(original, child.id!);
  const edited = { ...original, name: "Changed name", steps: editFlowSiblings(original.steps, [0, 0, 0], steps => steps.map(step => ({ ...step, config: { ...step.config, amount: 3 } }))) };
  assert.equal(flowEditorChanged(edited, snapshot), true);
  const restored = restoreFlowEditor(edited, snapshot);
  assert.equal(restored.name, "Changed name");
  assert.equal(flowActionLocations(restored.steps).find(item => item.action.id === child.id)!.action.config.amount, 1);
  assert.equal(flowEditorChanged(restored, snapshot), false);
  assert.deepEqual(restored.steps[1], edited.steps[1]);
  assert.deepEqual(original.steps[0], split, "rollback must not mutate its baseline");
});

test("discarding trigger edits preserves action edits", () => {
  const original = structuredClone(defaultFlowInput);
  const snapshot = flowEditorSnapshot(original, "trigger");
  const edited = { ...original, triggerConfig: { ...original.triggerConfig, reentryMode: "no_reentry" }, steps: [blankStep("stop")] };
  const restored = restoreFlowEditor(edited, snapshot);
  assert.deepEqual(restored.triggerConfig, original.triggerConfig);
  assert.deepEqual(restored.steps, edited.steps);
});

test("discarding a newly inserted action removes only that action", () => {
  const original = structuredClone(defaultFlowInput), action = blankStep("wait");
  const snapshot = flowEditorSnapshot(original, action.id!);
  const edited = { ...original, steps: [...original.steps, action] };
  assert.equal(flowEditorChanged(edited, snapshot), true);
  assert.deepEqual(restoreFlowEditor(edited, snapshot), original);
});
