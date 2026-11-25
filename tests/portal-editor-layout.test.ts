import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

test("website editor keeps balanced sidebar widths and compact padding with workflow panel styling", () => {
  const workflow = readFileSync("components/workflow-editor.css", "utf8");
  const portal = readFileSync("components/portal-builder.css", "utf8");
  const dom = new JSDOM(`<style>${workflow}\n${portal}</style>
    <div class="workflow-editor"><header class="wf-topbar"></header><div class="wf-workbench"><aside class="wf-panel wf-palette"></aside><aside class="wf-panel wf-inspector"><div class="wf-settings-heading"></div><div class="wf-inspector-content"></div><div class="wf-settings-footer"></div></aside></div></div>
    <div class="portal-builder"><header class="pb-topbar"></header><div class="pb-workbench"><aside class="pb-structure"><div class="pb-structure-heading"></div></aside><aside class="pb-editor"><div class="pb-inspector-title"></div><div class="pb-inspector-mode"></div><div class="pb-panel"></div><div class="pb-editor-footer"></div></aside></div></div>`);
  const computed = (selector: string) => dom.window.getComputedStyle(dom.window.document.querySelector(selector)!);
  try {
    const pairs = [
      [".pb-topbar", ".wf-topbar", ["display", "min-height", "padding", "gap", "flex-wrap"]],
      [".pb-workbench", ".wf-workbench", ["padding"]],
      [".pb-structure", ".wf-panel", ["border-radius", "border-width"]],
      [".pb-editor", ".wf-panel", ["border-radius", "border-width"]],
      [".pb-inspector-title", ".pb-structure-heading", ["min-height", "padding", "gap"]],
      [".pb-editor-footer", ".wf-settings-footer", ["min-height"]],
    ] as const;
    for (const [site, flow, properties] of pairs) for (const property of properties) {
      assert.equal(computed(site).getPropertyValue(property), computed(flow).getPropertyValue(property), `${site} ${property}`);
    }
    assert.equal(computed(".pb-workbench").gap, "6px");
    const columns = computed(".pb-workbench").gridTemplateColumns.split(" ");
    assert.equal(columns[0], "280px");
    assert.equal(columns.at(-1), columns[0]);
    for (const selector of [".pb-panel", ".pb-inspector-mode", ".pb-editor-footer"]) {
      assert.equal(computed(selector).paddingLeft, computed(".pb-structure-heading").paddingLeft);
    }
    assert.equal(computed(".portal-builder").getPropertyValue("--pb-canvas-background"), computed(".workflow-editor").getPropertyValue("--wf-canvas-background"));
  } finally { dom.window.close(); }
});
