import assert from "node:assert/strict";
import test from "node:test";
import { blankStep, type FlowInput, type JsonConfig } from "../lib/flows.ts";
import { FLOW_BRANCH_GAP, flowNodeWidth, flowPaths, flowSplitLayout } from "../lib/flow-tree.ts";
import { FLOW_NODE_GAP, layoutFlowNodes } from "../lib/flow-canvas.ts";

type Action = FlowInput["steps"][number];

function split(branches: Action[][]): Action {
  return { ...blankStep("split"), config: { paths: branches.map((steps, index) => ({ id: `path-${index}`, name: `Path ${index}`, condition: index === branches.length - 1 ? null : { field: "customer_replied" }, steps })) as unknown as JsonConfig["paths"] } };
}

function verifyStructure(action: Action, cardWidth: number) {
  if (action.type !== "split") {
    assert.equal(flowNodeWidth(action, cardWidth), cardWidth);
    return;
  }
  const { centers, columnWidths, width, railInset } = flowSplitLayout(action.config, cardWidth);
  const paths = flowPaths(action.config);
  assert.equal(railInset, width / 2 + centers[0]);
  assert.equal(railInset, width / 2 - centers.at(-1)!);
  for (let index = 0; index < paths.length; index++) {
    // Each lane contains every descendant and stays inside its parent's envelope.
    assert.ok(centers[index] - columnWidths[index] / 2 >= -width / 2);
    assert.ok(centers[index] + columnWidths[index] / 2 <= width / 2);
    assert.equal(centers[index], -centers[centers.length - 1 - index] || 0);
    if (index > 0) {
      const previousRight = centers[index - 1] + columnWidths[index - 1] / 2;
      const currentLeft = centers[index] - columnWidths[index] / 2;
      assert.ok(currentLeft - previousRight >= FLOW_BRANCH_GAP, "Sibling subtrees must have a clear gutter");
    }
    if (index > 1) assert.equal(centers[index] - centers[index - 1], centers[1] - centers[0]);
    for (const child of paths[index].steps) {
      assert.ok(flowNodeWidth(child, cardWidth) <= columnWidths[index]);
      verifyStructure(child, cardWidth);
    }
  }
}

test("uneven nested splits stay symmetric and keep descendants clear of the neighbouring stop card", () => {
  for (const side of [0, 1]) {
    let nested = split([[blankStep("create_task")], [blankStep("stop")]]);
    for (let depth = 1; depth < 5; depth++) {
      const branches = [[blankStep("stop")], [blankStep("stop")]];
      branches[side] = [blankStep("ai_auto_reply"), blankStep("wait"), nested];
      nested = split(branches);
    }
    for (const width of [280, 340]) verifyStructure(nested, width);
  }
});

test("layout invariants hold for varied multi-path trees and consecutive nested splits", () => {
  let seed = 7391;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let sample = 0; sample < 100; sample++) {
    let remaining = 150;
    const generate = (depth: number): Action => {
      remaining--;
      if (depth === 0 || remaining < 10 || random() % 3 === 0) return blankStep(random() % 2 ? "stop" : "internal_alert");
      return split(Array.from({ length: 2 + random() % 4 }, () => Array.from({ length: 1 + random() % 2 }, () => generate(depth - 1))));
    };
    const root = split([[generate(4), generate(4)], [generate(4)]]);
    for (const width of [280, 340]) verifyStructure(root, width);
  }
  verifyStructure(split(Array.from({ length: 20 }, () => [blankStep("stop")])), 340);
});

test("a taller measured split pushes every following action down with the same gap", () => {
  for (const height of [72, 800, 12000]) {
    const layout = layoutFlowNodes(["split", "after", "stop"], { __trigger: 68, split: height, after: 132, stop: 64 });
    const nodes = [layout.trigger, ...layout.steps, layout.end];
    for (let index = 1; index < nodes.length; index++) {
      assert.equal(nodes[index].y - nodes[index - 1].y - nodes[index - 1].height, FLOW_NODE_GAP);
    }
  }
});
