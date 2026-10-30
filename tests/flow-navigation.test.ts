import test from "node:test";
import assert from "node:assert/strict";
import { blankStep, type JsonConfig } from "../lib/flows.ts";
import { flowActionLocations, flowActionTrail } from "../lib/flow-tree.ts";

test("outline ancestry distinguishes identically named actions in nested branches", () => {
  const first = blankStep("create_task"), second = blankStep("create_task");
  const inner = { ...blankStep("split"), config: { name: "Market", paths: [{ id: "eu", name: "Europe", condition: null, steps: [second] }] as unknown as JsonConfig["paths"] } };
  const outer = { ...blankStep("split"), config: { name: "Qualification", paths: [{ id: "fit", name: "Qualified", condition: {}, steps: [first, inner] }, { id: "other", name: "Everyone else", condition: null, steps: [] }] as unknown as JsonConfig["paths"] } };
  const steps = [outer];
  const locations = flowActionLocations(steps);
  assert.deepEqual(flowActionTrail(steps, locations.find(({ action }) => action.id === first.id)!.path), ["Qualification", "Qualified"]);
  assert.deepEqual(flowActionTrail(steps, locations.find(({ action }) => action.id === second.id)!.path), ["Qualification", "Qualified", "Market", "Europe"]);
  assert.deepEqual(flowActionTrail(steps, [0]), []);
  for (const path of [[], [0, 0], [0, -1, 0], [0, 20, 0], [0, 0, 10], [0.5]]) assert.deepEqual(flowActionTrail(steps, path), []);
});
