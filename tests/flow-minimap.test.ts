import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { flowMinimapBounds, measureFlowMinimap } from "../lib/flow-minimap.ts";

function fixture(scale = 1, pan = { x: 0, y: 0 }) {
  const dom = new JSDOM(`<div id="content">
    <svg id="root-rail"><g><path class="wf-connector-stroke" d="M 350 132 L 350 188" /></g></svg>
    <div data-flow-node-id="__trigger"><button class="wf-trigger-card" id="trigger"></button></div>
    <div data-flow-node-id="split" data-flow-action-id="split" id="split-wrapper">
      <div data-flow-card data-flow-kind="split" id="split"></div>
      <div data-flow-split-branches>
        <svg id="branch-rail"><g><path class="wf-connector-stroke" d="M 600 0 L 164 56" /></g></svg>
        <div data-flow-branch-id="matches"><button data-flow-path-header id="matches"></button>
          <div class="wf-branch-insert" id="insert"></div>
          <div data-flow-action-id="task"><div data-flow-card data-flow-kind="create_task" id="task"></div></div>
          <div data-flow-action-id="nested"><div data-flow-card data-flow-kind="split" id="nested"></div>
            <div data-flow-branch-id="nested-match"><button data-flow-path-header id="nested-match"></button>
              <div data-flow-action-id="stop"><div data-flow-card data-flow-kind="stop" id="stop"></div></div>
            </div>
          </div>
        </div>
        <div data-flow-branch-id="else"><button data-flow-path-header id="else"></button>
          <div data-flow-action-id="email"><div data-flow-card data-flow-kind="ai_auto_reply" id="email"></div></div>
          <div class="wf-branch-tail wf-connector-line" id="tail"></div>
        </div>
      </div>
    </div>
    <div data-flow-node-id="__end" id="end"></div>
  </div>`);
  const content = dom.window.document.getElementById("content")!;
  const positions: Record<string, number[]> = {
    content: [0, 0, 2400, 2400], "root-rail": [0, 0, 2400, 2400],
    trigger: [180, 64, 340, 68], "split-wrapper": [-420, 188, 1540, 2200],
    split: [180, 188, 340, 72], "branch-rail": [-420, 288, 1540, 56],
    matches: [-420, 344, 340, 110], insert: [-420, 454, 340, 56], task: [-420, 510, 340, 132],
    nested: [-420, 698, 340, 72], "nested-match": [-900, 826, 340, 110], stop: [-900, 992, 340, 68],
    else: [780, 344, 340, 72], email: [780, 472, 340, 132], tail: [949, 660, 2, 28], end: [269, 2444, 162, 34],
  };
  Object.defineProperty(content, "offsetWidth", { value: 2400 });
  for (const [id, [x, y, width, height]] of Object.entries(positions)) {
    dom.window.document.getElementById(id)!.getBoundingClientRect = () => ({
      x: x * scale + pan.x, y: y * scale + pan.y, left: x * scale + pan.x, top: y * scale + pan.y,
      width: width * scale, height: height * scale, right: (x + width) * scale + pan.x, bottom: (y + height) * scale + pan.y, toJSON() {},
    });
  }
  return { dom, content };
}

test("minimap shows every actual action and nested path instead of a filled split envelope", () => {
  const { dom, content } = fixture();
  try {
    const map = measureFlowMinimap(content);
    assert.deepEqual(map.nodes.map(node => node.id), ["__trigger", "split", "path:matches", "task", "nested", "path:nested-match", "stop", "path:else", "email", "__end"]);
    assert.deepEqual(map.nodes.find(node => node.id === "split"), { id: "split", kind: "split", x: 180, y: 188, width: 340, height: 72 });
    assert.equal(map.nodes.find(node => node.id === "email")!.kind, "ai_auto_reply");
    assert.equal(map.connectors.length, 4);
    assert.deepEqual(map.connectors[1], { path: "M 600 0 L 164 56", x: -420, y: 288 });
    assert.deepEqual(map.connectors[2], { path: "M -250 454 v 56", x: 0, y: 0 });
    assert.deepEqual(map.connectors[3], { path: "M 950 660 v 28", x: 0, y: 0 });
  } finally { dom.window.close(); }
});

test("minimap coordinates remain stable when the canvas is zoomed and panned offscreen", () => {
  const original = fixture();
  try {
    const expected = measureFlowMinimap(original.content);
    for (const zoom of [0.001, 0.25, 0.75, 1.5]) {
      const { dom, content } = fixture(zoom, { x: -1200, y: 830 });
      try {
        const actual = measureFlowMinimap(content);
        assert.deepEqual(actual.nodes.map(node => node.id), expected.nodes.map(node => node.id));
        for (let index = 0; index < expected.nodes.length; index++) {
          for (const key of ["x", "y", "width", "height"] as const) assert.ok(Math.abs(actual.nodes[index][key] - expected.nodes[index][key]) < 0.0001);
        }
      } finally { dom.window.close(); }
    }
  } finally { original.dom.window.close(); }
});

test("minimap bounds include the complete nested flow with padding and an undistorted aspect ratio", () => {
  const { dom, content } = fixture();
  try {
    const { nodes } = measureFlowMinimap(content);
    const bounds = flowMinimapBounds(nodes);
    assert.equal(bounds.width / bounds.height, 4 / 3);
    for (const node of nodes) {
      assert.ok(node.x >= bounds.x + 59.99 && node.y >= bounds.y + 59.99);
      assert.ok(node.x + node.width <= bounds.x + bounds.width - 59.99);
      assert.ok(node.y + node.height <= bounds.y + bounds.height - 59.99);
    }
    content.querySelector('[data-flow-action-id="nested"]')!.remove();
    assert.equal(measureFlowMinimap(content).nodes.some(node => ["nested", "stop", "path:nested-match"].includes(node.id)), false);
  } finally { dom.window.close(); }
  assert.deepEqual(flowMinimapBounds([]), { x: 0, y: 0, width: 800, height: 600 });
});
