import assert from "node:assert/strict";
import test from "node:test";
import { applyFlowEmailTemplate } from "../lib/flow-email-editor.ts";
import { blankStep, flowEmailStatus, flowInputSchema, defaultFlowInput, stepConfigSchemas } from "../lib/flows.ts";
import { newEmailDesign } from "../lib/email-design.ts";
import { buildFlowEmail, verifyTracking } from "../lib/flow-tracking.ts";
import { simulateFlow } from "../lib/flow-engine.ts";
import { flowEmailTestFacts } from "../lib/flow-email-test.ts";

test("library selection copies the design into a validated, persistent workflow action", () => {
  const design = newEmailDesign("Hello {{first_name}}, welcome!", "text");
  const next = applyFlowEmailTemplate(blankStep("send_email").config, { id: "library-template", name: "Welcome email", subject: "Welcome", design });
  const saved = flowInputSchema.parse({ ...defaultFlowInput, steps: [{ id: "email", type: "send_email", config: { ...next, emailName: "First email" } }] });
  assert.equal(saved.steps[0].config.sourceTemplateId, "library-template");
  assert.equal(saved.steps[0].config.templateId, "custom");
  assert.equal(saved.steps[0].config.emailName, "First email");
  assert.deepEqual(saved.steps[0].config.emailDesign, design);
  assert.equal(saved.steps[0].config.body, "Hello {{first_name}}, welcome!");
  assert.equal(saved.steps[0].config.smartSendingHours, 16);
});

test("email statuses persist independently, keep legacy emails enabled, and allow incomplete drafts", () => {
  assert.equal(flowEmailStatus({}), "live");
  for (const emailStatus of ["draft", "live"]) {
    const config = { ...defaultFlowInput.steps[1].config, emailStatus };
    assert.equal(stepConfigSchemas.send_email.parse(config).emailStatus, emailStatus);
    assert.equal(flowEmailStatus(config), emailStatus);
  }
  assert.equal(stepConfigSchemas.send_email.parse({ ...defaultFlowInput.steps[1].config, emailStatus: "paused" }).emailStatus, "draft");
  assert.equal(flowEmailStatus({ emailStatus: "paused" }), "draft");
  assert.ok(stepConfigSchemas.send_email.safeParse({ ...blankStep("send_email").config, emailStatus: "draft" }).success);
  assert.equal(stepConfigSchemas.send_email.safeParse({ ...blankStep("send_email").config, emailStatus: "live" }).success, false);
  assert.equal(stepConfigSchemas.send_email.safeParse({ ...defaultFlowInput.steps[1].config, emailStatus: "invalid" }).success, false);
});

test("journey simulation skips draft emails and treats retired paused values as drafts", () => {
  const facts = flowEmailTestFacts({ flow: defaultFlowInput, customerName: "Test", companyName: "Company", firstMessage: true, emails: [{ from: "customer@example.com", subject: "Hello", body: "Hello" }] });
  for (const emailStatus of ["draft", "paused"]) {
    const flow = { ...defaultFlowInput, steps: [{ ...defaultFlowInput.steps[1], config: { ...defaultFlowInput.steps[1].config, emailStatus } }, blankStep("create_task")] };
    const result = simulateFlow(flow, facts);
    assert.equal(result.trace[0].status, "skipped");
    assert.equal(result.trace.length, 2);
  }
});

test("template changes keep the entered subject and remove the previous design for text templates", () => {
  const initial = { ...blankStep("send_email").config, subject: "My subject", emailDesign: newEmailDesign("Previous") };
  const next = applyFlowEmailTemplate(initial, { id: "new", name: "Text template", subject: "Template subject", body: "New message" });
  assert.equal(next.subject, "My subject");
  assert.equal(next.body, "New message");
  assert.equal(next.emailDesign, undefined);
  assert.ok(initial.emailDesign);
});

test("custom messages require real content and a subject, while legacy templates still validate", () => {
  const config = { ...defaultFlowInput.steps[1].config, templateId: "custom" };
  assert.equal(stepConfigSchemas.send_email.safeParse(config).success, false);
  assert.equal(stepConfigSchemas.send_email.safeParse({ ...config, body: "Message", subject: "" }).success, false);
  assert.equal(stepConfigSchemas.send_email.safeParse({ ...config, body: "Message" }).success, true);
  assert.equal(stepConfigSchemas.send_email.safeParse(defaultFlowInput.steps[1].config).success, true);
});

test("designed workflow emails retain HTML, personalize safely, and track actual destination links", () => {
  const design = newEmailDesign('<html><body><table><tr><td>Hello {{first_name}}<a href="https://example.com/catalog">Catalog</a><script>alert(1)</script></td></tr></table></body></html>', "html");
  const config = applyFlowEmailTemplate(blankStep("send_email").config, { name: "Catalog", subject: "Catalog", design });
  const result = buildFlowEmail({ body: "Hello Alex", config: { ...config, utmTracking: true }, runId: "00000000-0000-4000-8000-000000000001", stepId: "email", flowId: "flow", appUrl: "https://crm.example.com", secret: "test", contact: { name: "Alex <script>", email: "alex@example.com" } });
  assert.match(result.html, /<table>/);
  assert.match(result.html, /Hello Alex/);
  assert.doesNotMatch(result.html, /<script>|alert\(1\)|&lt;table/);
  const href = /href="([^"]+)"/.exec(result.html)![1].replaceAll("&amp;", "&");
  const token = new URL(href).searchParams.get("token")!;
  const tracking = verifyTracking(token, "test");
  assert.equal(tracking?.kind, "click");
  assert.equal(new URL(tracking!.target!).searchParams.get("utm_campaign"), "flow");
});

test("designed test emails respect disabled click, open and UTM tracking", () => {
  const design = newEmailDesign('<html><body><a href="https://example.com/">Hello {{first_name}}</a></body></html>', "html");
  const result = buildFlowEmail({ body: "Hello Alex", config: { emailDesign: design, trackOpens: false, trackClicks: false, utmTracking: false }, runId: "test", stepId: "email", flowId: "flow", appUrl: "https://crm.example.com", secret: "test", contact: { name: "Alex", email: "alex@example.com" } });
  assert.match(result.html, /Hello Alex/);
  assert.match(result.html, /href="https:\/\/example.com\/"/);
  assert.doesNotMatch(result.html, /token=|utm_|width="1"/);
});
