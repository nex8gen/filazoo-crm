import assert from "node:assert/strict";
import test from "node:test";
import { blankStep, type JsonConfig, type FlowInput } from "../lib/flows.ts";
import { dropFlowAction, flowPaths, flowActionLocations } from "../lib/flow-tree.ts";

function split(id: string, steps: FlowInput["steps"] = []) {
  return { ...blankStep("split"), id, config: { name: id, paths: [{ id: `${id}-match`, name: "Match", condition: { field: "customer_replied" }, steps }, { id: `${id}-else`, name: "Otherwise", condition: null, steps: [] }] as unknown as JsonConfig["paths"] } };
}
test("palette drops insert into either empty split path without appending a root step", () => {
  for (const branchId of ["split-match", "split-else"]) {
    const steps = [split("split"), blankStep("stop")];
    const before = JSON.stringify(steps), action = blankStep("change_category");
    const result = dropFlowAction(steps, { branchId, index: 0 }, { action });
    assert.equal(result.error, undefined);
    assert.equal(result.steps.length, 2);
    assert.equal(flowPaths(result.steps[0].config).find((path) => path.id === branchId)?.steps[0].id, action.id);
    assert.equal(JSON.stringify(steps), before);
  }
});
test("moving an earlier root action into a nested path resolves the branch after root indices shift", () => {
  const action = blankStep("create_task"), steps = [action, split("outer", [split("inner")]), blankStep("stop")];
  const result = dropFlowAction(steps, { branchId: "inner-else", index: 0 }, { actionId: action.id! });
  assert.equal(result.error, undefined);
  assert.equal(result.steps[0].id, "outer");
  const locations = flowActionLocations(result.steps).filter((item) => item.action.id === action.id);
  assert.equal(locations.length, 1);
  assert.deepEqual(locations[0].path, [0, 0, 0, 1, 0]);
});
test("actions can move between branches, back to the root and within the same path", () => {
  const a = blankStep("wait"), b = blankStep("create_task"), c = blankStep("stop");
  const steps = [split("split", [a, b, c])];
  const reordered = dropFlowAction(steps, { branchId: "split-match", index: 3 }, { actionId: a.id! });
  assert.deepEqual(flowPaths(reordered.steps[0].config)[0].steps.map((step) => step.id), [b.id, c.id, a.id]);
  const other = dropFlowAction(reordered.steps, { branchId: "split-else", index: 0 }, { actionId: a.id! });
  assert.equal(flowPaths(other.steps[0].config)[1].steps[0].id, a.id);
  const root = dropFlowAction(other.steps, { branchId: null, index: 0 }, { actionId: a.id! });
  assert.equal(root.steps[0].id, a.id);
  assert.equal(flowPaths(root.steps[1].config)[1].steps.length, 0);
});
test("splits cannot be dropped into their own descendants and failed drops leave the source intact", () => {
  const steps = [split("outer", [split("inner")])];
  const result = dropFlowAction(steps, { branchId: "inner-match", index: 0 }, { actionId: "outer" });
  assert.match(result.error!, /own paths/);
  assert.equal(result.steps, steps);
  assert.equal(dropFlowAction(steps, { branchId: "missing", index: 0 }, { action: blankStep("wait") }).steps, steps);
});
test("dragging obeys branch capacity and nesting limits, while no-op drops preserve the tree", () => {
  const full = [split("full", Array.from({ length: 25 }, () => blankStep("wait")))];
  assert.match(dropFlowAction(full, { branchId: "full-match", index: 0 }, { action: blankStep("wait") }).error!, /25 actions/);
  const moved = dropFlowAction(full, { branchId: "full-match", index: 25 }, { actionId: flowPaths(full[0].config)[0].steps[0].id! });
  assert.equal(moved.error, undefined);
  let nested = split("level-4"); for (let depth = 3; depth >= 0; depth--) nested = split(`level-${depth}`, [nested]);
  assert.match(dropFlowAction([nested], { branchId: "level-4-match", index: 0 }, { action: split("too-deep") }).error!, /five levels/);
  assert.equal(dropFlowAction(full, { branchId: null, index: 1 }, { actionId: "full" }).steps, full);
});

test("moving a split preserves its entire configured subtree and adjusts the destination index", () => {
  const task = blankStep("create_task"), stop = blankStep("stop");
  const subtree = split("nested", [task]);
  const steps = [split("outer", [subtree, stop])];
  const result = dropFlowAction(steps, { branchId: "outer-match", index: 2 }, { actionId: "nested" });
  assert.equal(result.error, undefined);
  assert.deepEqual(flowPaths(result.steps[0].config)[0].steps, [stop, subtree]);
  assert.deepEqual(flowPaths(steps[0].config)[0].steps, [subtree, stop]);
  assert.equal(flowActionLocations(result.steps).filter(({ action }) => action.id === task.id).length, 1);
});

test("total action limits and stale or malformed targets cannot discard the source", () => {
  const steps = Array.from({ length: 500 }, () => blankStep("wait"));
  assert.match(dropFlowAction(steps, { branchId: null, index: 0 }, { action: blankStep("wait") }).error!, /500 actions/);
  const moved = dropFlowAction(steps, { branchId: null, index: 500 }, { actionId: steps[0].id! });
  assert.equal(moved.error, undefined);
  assert.equal(moved.steps.at(-1)?.id, steps[0].id);
  for (const index of [-1, 0.5, 501, NaN]) {
    assert.equal(dropFlowAction(steps, { branchId: null, index }, { actionId: steps[0].id! }).steps, steps);
  }
  assert.equal(dropFlowAction(steps, { branchId: null, index: 0 }, { actionId: "deleted" }).steps, steps);
});
