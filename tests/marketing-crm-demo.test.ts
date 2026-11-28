import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

test("public CRM exports use fixture records and production layouts without executable app content", () => {
  const selectors = { home: ".home-workspace", email: ".email-inbox-layout", workflow: ".workflow-editor", orders: ".po-register" };
  for (const [view, selector] of Object.entries(selectors)) {
    const html = readFileSync(`public/marketing/crm-demo/${view}.html`, "utf8");
    const document = new JSDOM(html).window.document;
    assert.ok(document.querySelector("#marketing-crm-demo[data-workspace-shell]"), view);
    assert.ok(document.querySelector(".workspace-sidebar"), view);
    if (view !== "email") assert.ok(document.querySelector(selector), view);
    else assert.ok(document.body.textContent!.includes("Quotation for our next collection"));
    if (view === "workflow") {
      const layer = document.querySelector<HTMLElement>(".wf-canvas > div[style*='visibility']")!;
      assert.equal(layer.style.visibility, "visible");
      assert.ok(layer.querySelectorAll("[data-flow-node-id]").length >= 4);
      assert.doesNotMatch(document.body.textContent!, /Invalid input:/);
    }
    assert.equal(document.querySelectorAll("script, iframe, object, embed, [srcdoc], a[href], form[action]").length, 0, view);
    assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")!, /connect-src 'none'/);
    assert.ok(document.body.textContent!.includes("6,000 credits"), view);
    assert.doesNotMatch(html, /(?:src|href|action)=["']https?:/i, view);
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) assert.ok(existsSync(path.join("public", link.getAttribute("href")!)), link.getAttribute("href")!);
  }
  const allCss = readdirSync("public/marketing/crm-demo/assets").filter(file => file.endsWith(".css")).map(file => readFileSync(`public/marketing/crm-demo/assets/${file}`, "utf8")).join("\n");
  for (const selector of [".workspace-sidebar", ".home-workspace", ".workflow-editor", ".po-register", ".email-workspace"]) assert.ok(allCss.includes(selector), `Missing production styles: ${selector}`);
});
