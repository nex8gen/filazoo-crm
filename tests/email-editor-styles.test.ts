import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

test("the editor's root layout selector applies after the bundled font declaration", () => {
  const stylesheet = readFileSync(new URL("../components/email-design-editor.css", import.meta.url), "utf8");
  // Exercise CSS parsing and selector matching: a displaced BOM silently turns
  // the root selector into an unmatched descendant selector in the browser.
  const rootStyles = stylesheet.slice(0, stylesheet.indexOf(".email-designer-header"));
  const dom = new JSDOM(`<style>${rootStyles}</style><div class="email-designer"></div>`);
  const root = dom.window.document.querySelector(".email-designer")!;
  const computed = dom.window.getComputedStyle(root);
  assert.equal(computed.display, "flex");
  assert.equal(computed.flexDirection, "column");
  assert.equal(computed.position, "absolute");
  assert.equal(computed.overflow, "hidden");
  dom.window.close();
});
