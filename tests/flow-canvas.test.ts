import assert from "node:assert/strict";
import test from "node:test";
import { canvasPointFromClient, flowInsertIndex, layoutFlowNodes, reorderFlowSteps, fitFlowCanvas } from "../lib/flow-canvas.ts";

test("palette drops insert at the top, middle, or bottom of the flow", () => {
  const { steps } = layoutFlowNodes(["wait", "email", "task"], {});
  assert.equal(flowInsertIndex(180, steps), 0);
  assert.equal(flowInsertIndex(350, steps), 1);
  assert.equal(flowInsertIndex(500, steps), 2);
  assert.equal(flowInsertIndex(900, steps), 3);
  assert.equal(flowInsertIndex(300, []), 0);
});

test("drop coordinates account for the viewport, canvas pan, and zoom", () => {
  const { steps } = layoutFlowNodes(["wait", "email", "task"], {});
  for (const zoom of [0.45, 0.8, 1, 1.5]) {
    const origin = { x: 300, y: 100 };
    const pan = { x: -120, y: -200 };
    const client = { x: origin.x + pan.x + 400 * zoom, y: origin.y + pan.y + 350 * zoom };
    const point = canvasPointFromClient(client, origin, pan, zoom);
    assert.equal(point.y, 350);
    assert.equal(flowInsertIndex(point.y, steps), 1);
  }
});

test("inserting into a flow shifts every later card and the end marker without overlap", () => {
  const { trigger, steps, end } = layoutFlowNodes(["wait", "new", "email", "task"], { __trigger: 190, new: 230, email: 150 }, 280);
  const nodes = [trigger, ...steps, end];
  for (let index = 1; index < nodes.length; index++) {
    assert.ok(nodes[index].y >= nodes[index - 1].y + nodes[index - 1].height + 48);
    assert.equal(nodes[index].x + nodes[index].width / 2, trigger.x + trigger.width / 2);
  }
});

test("dragging a step moves it to the drop slot and preserves the remaining execution order", () => {
  const ids = ["wait", "email", "task", "reply"];
  const { steps } = layoutFlowNodes(ids, {});
  const target = flowInsertIndex(350, steps.filter((step) => step.id !== "reply"));
  assert.deepEqual(reorderFlowSteps(ids, 3, target), ["wait", "reply", "email", "task"]);
  assert.deepEqual(reorderFlowSteps(ids, 0, 3), ["email", "task", "reply", "wait"]);
  assert.deepEqual(ids, ["wait", "email", "task", "reply"]);
});

test("reordering, deletion, and duplication keep the canvas in execution order", () => {
  const ids = reorderFlowSteps(["wait", "email", "task"], 2, 0);
  ids.splice(1, 0, "copy");
  ids.splice(2, 1);
  const { steps, end } = layoutFlowNodes(ids, {});
  assert.deepEqual(steps.map((step) => step.id), ["task", "copy", "email"]);
  assert.ok(end.y > steps.at(-1)!.y + steps.at(-1)!.height);
});

test("invalid moves and single-step moves leave the sequence intact", () => {
  const ids = ["wait"];
  assert.equal(reorderFlowSteps(ids, 0, 1), ids);
  assert.equal(reorderFlowSteps(ids, -1, 0), ids);
  assert.equal(reorderFlowSteps(ids, 0, 0), ids);
});

test("fit includes wide nested branches and tall journeys instead of cropping them at 45 percent", () => {
  for (const width of [440, 3600, 180000]) for (const height of [800, 10000]) {
    const nodes = [{ id: "wide", x: -width / 2, y: 64, width, height }];
    const viewport = { width: 1280, height: 800 };
    const { zoom, pan } = fitFlowCanvas(nodes, viewport);
    assert.ok(nodes[0].x * zoom + pan.x >= 59.99);
    assert.ok((nodes[0].x + width) * zoom + pan.x <= viewport.width - 59.99);
    assert.ok(nodes[0].y * zoom + pan.y >= 49.99);
    assert.ok((nodes[0].y + height) * zoom + pan.y <= viewport.height - 49.99);
  }
});
