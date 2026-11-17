import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const styles = readFileSync(new URL("../components/workflow-editor.css", import.meta.url), "utf8");

test("connector color stays local to its action even when the workflow summary has an error", () => {
  for (const state of ["live", "error", "idle", "unknown"]) {
    const dom = new JSDOM(`<style>${styles}</style><div class="workflow-editor" data-flow-health="error"><svg><g class="wf-connector" data-flow-health="${state}"><path class="wf-connector-stroke" /></g></svg></div>`);
    try {
      const editor = dom.window.document.querySelector(".workflow-editor")!;
      if (state === "error") assert.equal(dom.window.getComputedStyle(editor.querySelector("g")!).getPropertyValue("--wf-connector-accent").trim(), "#e5484d");
      assert.notEqual(dom.window.getComputedStyle(editor).getPropertyValue("--wf-connector-accent").trim(), "#e5484d", "A summary error must not turn every connector red");
    } finally { dom.window.close(); }
  }
});

test("breadcrumb separator styling preserves the Live badge's text contrast", () => {
  const dom = new JSDOM(`<style>.live-badge { background-color: rgb(37, 99, 235); color: white; } ${styles}</style><div class="workflow-editor"><div class="wf-breadcrumb"><button>Flows</button><span aria-hidden="true">/</span><div>Workflow name</div><span id="live" class="live-badge" data-slot="badge">Live</span></div></div>`);
  try {
    const badge = dom.window.getComputedStyle(dom.window.document.getElementById("live")!);
    assert.equal(badge.color, "rgb(255, 255, 255)");
    assert.equal(badge.backgroundColor, "rgb(37, 99, 235)");
  } finally {
    dom.window.close();
  }
});

test("toolbar commands containing an icon keep their text width while icon controls stay square", () => {
  for (const grouped of [true, false]) {
    const commands = '<button id="audit" data-slot="button" class="wf-text-button wf-audit-button"><svg></svg>Audit flow</button><button id="pause" data-slot="button" class="wf-text-button wf-pause-button"><svg></svg>Pause</button><button id="launch" data-slot="button" class="wf-text-button wf-launch-button">Review and turn on</button>';
    const dom = new JSDOM(`<style>${styles}</style><div class="workflow-editor"><header class="wf-topbar"><div class="wf-toolbar-actions"><div class="wf-toolbar-tools"><button id="save" data-slot="button" class="wf-icon-button"><svg></svg></button></div>${grouped ? `<div class="wf-toolbar-commands">${commands}</div>` : commands}</div></header></div>`);
    try {
      for (const id of ["audit", "pause", "launch"]) {
        const style = dom.window.getComputedStyle(dom.window.document.getElementById(id)!);
        assert.equal(style.width, "auto", `${id} must size to its label`);
        assert.equal(style.flexShrink, "0", `${id} must not shrink below its label`);
        assert.equal(style.whiteSpace, "nowrap");
      }
      const icon = dom.window.getComputedStyle(dom.window.document.getElementById("save")!);
      assert.equal(icon.width, "32px");
      assert.equal(icon.height, "32px");
    } finally {
      dom.window.close();
    }
  }
});

test("toolbar groups can wrap as units instead of clipping their commands", () => {
  const dom = new JSDOM(`<style>${styles}</style><div class="workflow-editor"><header class="wf-topbar"><div class="wf-toolbar-actions"><div class="wf-toolbar-tools"></div><div class="wf-toolbar-commands"></div></div></header></div>`);
  try {
    for (const selector of [".wf-topbar", ".wf-toolbar-actions"]) {
      assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(selector)!).flexWrap, "wrap");
    }
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector(".wf-toolbar-commands")!).flexShrink, "0");
  } finally {
    dom.window.close();
  }
});
