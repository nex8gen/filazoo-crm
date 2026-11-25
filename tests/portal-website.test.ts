import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePortalWebsite, portalWebsiteDocument } from "../lib/portal-website.ts";
import { defaultPortalDesign, portalDesignSchema } from "../lib/portal-design.ts";

test("website layouts remove active content and preserve visual page sections", () => {
  const clean = sanitizePortalWebsite({ html: '<section class="fz-grid" onclick="alert(1)" style="padding:24px"><h1>Hello</h1><img src="https://example.com/image.jpg" onerror="alert(1)"><a href="javascript:alert(1)">Bad</a><script>alert(1)</script><iframe src="/settings"></iframe><form action="/api"><input name="password"></form><svg onload="alert(1)"></svg></section>', css: ".fz-grid{display:grid;gap:24px}" });
  assert.match(clean.html, /class="fz-grid"/);
  assert.match(clean.html, /padding:24px/);
  assert.doesNotMatch(clean.html, /onclick|onerror|javascript:|script|iframe|form|svg/);
  assert.equal(clean.css, ".fz-grid{display:grid;gap:24px}");
  assert.deepEqual(sanitizePortalWebsite(clean), clean);
});

test("layouts reject CSS imports, escape attempts and executable URLs", () => {
  for (const css of ['@import "https://evil.test";', 'body{background:url(https://evil.test)}', '</style><script>alert(1)</script>', 'body{color:e\\78pression(alert(1))}']) {
    assert.equal(sanitizePortalWebsite({ html: "<p>Safe</p>", css }).css, "");
  }
  const doc = portalWebsiteDocument({ html: '<img src="data:image/svg+xml,evil"><p>Safe</p>', css: "" });
  assert.match(doc, /default-src 'none'/);
  assert.match(doc, /form-action 'none'/);
  assert.doesNotMatch(doc, /data:image|<script|<iframe/);
});

test("existing themes remain compatible and draft website layouts survive the persistence schema", () => {
  const design = defaultPortalDesign();
  assert.deepEqual(portalDesignSchema.parse(design), design);
  design.sections[0].website = { html: '<section><h1>My website</h1><script>alert(1)</script></section>', css: "h1{font-size:48px}" };
  const saved = portalDesignSchema.parse(JSON.parse(JSON.stringify(design)));
  assert.equal(saved.sections[0].website?.html, "<section><h1>My website</h1></section>");
  assert.equal(saved.features.sendMessages, true);
  assert.equal(saved.sections.filter(section => section.type === "invoice").length, 1);
  design.sections[0].website.html = "x".repeat(60001);
  assert.equal(portalDesignSchema.safeParse(design).success, false);
});
