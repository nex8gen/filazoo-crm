import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { canPanFlowCanvas, canHandleFlowCanvasWheel } from "../lib/flow-canvas.ts";

function canvasFixture() {
  return new JSDOM(`<main id="canvas">
    <div id="transform">
      <div data-canvas-node id="wait-wrapper"><div data-flow-card role="button" id="wait"><span id="wait-label">Wait 1 day</span></div></div>
      <div data-canvas-node id="split-wrapper">
        <div data-flow-card id="split">Split</div>
        <div data-no-drag data-flow-split-branches id="lanes">
          <div data-flow-branch-id="match" id="branch">
            <button data-flow-path-header id="path"><span id="path-label">Matches</span></button>
            <div data-flow-branch-insert-index="0" id="gap"><button id="add"><svg id="add-icon"></svg></button></div>
            <div data-flow-card id="email"><div data-no-drag id="configure-body"><button id="configure">Configure email</button></div></div>
            <div id="footer">Continue after split</div>
          </div>
        </div>
      </div>
      <div data-canvas-node id="end">End of workflow</div>
    </div>
    <button class="wf-trigger-card" id="trigger">Trigger</button>
    <div data-canvas-controls id="tools"><span id="zoom-label">100%</span></div>
    <input id="input"><div contenteditable="true" id="editable">Name</div>
    <div role="menu" id="menu"><span id="menu-label">Edit</span></div>
  </main><div id="portal"><button id="portal-item">Outside menu item</button></div>`);
}

test("panning starts in empty space around narrow cards, split lanes and connectors", () => {
  const dom = canvasFixture();
  try {
    const document = dom.window.document, viewport = document.getElementById("canvas")!;
    for (const id of ["canvas", "transform", "wait-wrapper", "split-wrapper", "lanes", "branch", "gap", "footer", "end"]) {
      assert.equal(canPanFlowCanvas(viewport, document.getElementById(id)!, 0), true, `${id} is canvas space`);
    }
  } finally { dom.window.close(); }
});

test("cards and their controls retain selection, reordering and editing gestures", () => {
  const dom = canvasFixture();
  try {
    const document = dom.window.document, viewport = document.getElementById("canvas")!;
    for (const id of ["wait", "wait-label", "split", "path", "path-label", "add", "add-icon", "email", "configure-body", "configure", "trigger", "tools", "zoom-label", "input", "editable", "menu-label"]) {
      assert.equal(canPanFlowCanvas(viewport, document.getElementById(id)!, 0), false, `${id} must handle its own interaction`);
    }
  } finally { dom.window.close(); }
});

test("portal events and secondary mouse buttons cannot accidentally move the canvas", () => {
  const dom = canvasFixture();
  try {
    const document = dom.window.document, viewport = document.getElementById("canvas")!;
    assert.equal(canPanFlowCanvas(viewport, document.getElementById("portal-item")!, 0), false);
    for (const button of [1, 2]) assert.equal(canPanFlowCanvas(viewport, document.getElementById("gap")!, button), false);
  } finally { dom.window.close(); }
});

test("wheel panning ignores popup content and form controls while cards and canvas still pan", () => {
  const dom = canvasFixture();
  try {
    const document = dom.window.document, viewport = document.getElementById("canvas")!;
    for (const id of ["portal-item", "menu-label", "zoom-label", "input", "editable"]) {
      assert.equal(canHandleFlowCanvasWheel(viewport, document.getElementById(id)!), false, id);
    }
    for (const id of ["canvas", "wait-label", "gap", "path-label"]) {
      assert.equal(canHandleFlowCanvasWheel(viewport, document.getElementById(id)!), true, id);
    }
    const popup = document.createElement("div");
    popup.dataset.slot = "popover-content";
    popup.innerHTML = "<span>More actions</span>";
    viewport.append(popup);
    assert.equal(canHandleFlowCanvasWheel(viewport, popup.firstElementChild!), false);
  } finally { dom.window.close(); }
});
