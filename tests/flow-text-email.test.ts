import assert from "node:assert/strict";
import test from "node:test";
import { applyFlowTextEmail, flowTextEmailDraft, flowTextEmailHtml, isFlowTextEmail } from "../lib/flow-text-email.ts";
import { applyFlowEmailTemplate } from "../lib/flow-email-editor.ts";
import { newEmailDesign } from "../lib/email-design.ts";
import { defaultFlowInput, stepConfigSchemas } from "../lib/flows.ts";
import { buildFlowEmail } from "../lib/flow-tracking.ts";

const original = defaultFlowInput.steps[1].config;
test("text-only content persists separately from templates and reopens in the message editor", () => {
  const next = applyFlowTextEmail(original, { body: "Hi {{first_name}},\nWelcome!", html: "<div>Hi {{first_name}},</div><p><strong>Welcome!</strong></p>", preheader: "A personal welcome", noPreview: false, font: "Georgia", fontSize: 16 });
  const saved = stepConfigSchemas.send_email.parse(next);
  assert.equal(saved.contentMode, "text");
  assert.equal(saved.templateName, "Text only email");
  assert.equal(isFlowTextEmail(saved), true);
  const reopened = flowTextEmailDraft(saved);
  assert.equal(reopened.font, "Georgia"); assert.equal(reopened.fontSize, 16);
  assert.equal(reopened.preheader, "A personal welcome");
  assert.match(reopened.html, /<strong>Welcome!<\/strong>/);
  assert.doesNotMatch(reopened.html, /<body/);
  assert.equal(saved.sourceTemplateId, undefined);
});

test("simple formatted emails reach delivery without a designed template frame", () => {
  const next = applyFlowTextEmail(original, { body: "Hi {{first_name}},\nRead our catalog https://example.com/", html: '<p>Hi {{first_name}},</p><p><b>Read our catalog</b> <a href="https://example.com/">Catalog</a></p>', preheader: "Welcome", noPreview: false, font: "Arial", fontSize: 14 });
  const sent = buildFlowEmail({ body: "Hi Alex,\nRead our catalog https://example.com/", config: next, contact: { name: "Alex <script>", email: "alex@example.com" }, runId: "00000000-0000-4000-8000-000000000001", stepId: "text-email", flowId: "flow", appUrl: "https://crm.example.com", secret: "test" });
  assert.match(sent.html, /Hi Alex,/);
  assert.match(sent.html, /<b>Read our catalog<\/b>/);
  assert.match(sent.html, /font-size:14px/);
  assert.match(sent.html, /api\/flows\/track/);
  assert.doesNotMatch(sent.html, /email-content|<table|<script>/);
});

test("no-preview mode clears the preheader and prevents the body from becoming an inbox preview", () => {
  const next = applyFlowTextEmail(original, { ...flowTextEmailDraft(original), preheader: "Previous preview", noPreview: true });
  assert.equal(next.preheader, ""); assert.equal(next.hidePreviewText, true);
  const sent = buildFlowEmail({ body: String(next.body), config: next, runId: "test", stepId: "email", flowId: "flow", appUrl: "https://crm.test", secret: "test" });
  assert.match(sent.html, /\u200c\u00a0/); assert.doesNotMatch(sent.html, /Previous preview/);
});

test("text and designed-template routes remain distinct, including older plain-text emails", () => {
  assert.equal(isFlowTextEmail(original), true);
  assert.equal(isFlowTextEmail({ emailDesign: newEmailDesign("Legacy text", "text") }), true);
  const next = applyFlowEmailTemplate({ ...original, contentMode: "text" }, { name: "Designed template", design: newEmailDesign("Template content") });
  assert.equal(isFlowTextEmail(next), false);
});

test("reopening text content strips active HTML before entering the rich-text editor", () => {
  const html = '<html><body><p onclick="alert(1)">Hello</p><script>alert(2)</script><iframe src="https://example.com/"></iframe><a href="javascript:alert(3)">Unsafe link</a></body></html>';
  const cleaned = flowTextEmailHtml({ contentMode: "text", emailDesign: newEmailDesign(html, "html") });
  assert.match(cleaned, /Hello/);
  assert.doesNotMatch(cleaned, /script|iframe|onclick|javascript:/);
});
