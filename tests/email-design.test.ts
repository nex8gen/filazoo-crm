import assert from "node:assert/strict";
import test from "node:test";
import { duplicateEmailBlock, emailDesignSchema, emailDesignText, moveEmailBlock, newEmailBlock, newEmailDesign, removeEmailBlock, renderEmailDesign, sanitizeEmailDesignHtml } from "../lib/email-design.ts";
import { isCampaignContactEligible } from "../lib/campaign-contact-eligibility.ts";
import { personalizeCampaign, selectCampaignRecipients } from "../lib/email-campaigns.ts";

test("nested email layouts retain columns, duplicate entire sections, and reject cycles", () => {
  const design = newEmailDesign();
  const columns = newEmailBlock("columns"), left = newEmailBlock("text", { parentId: columns.id, text: "Left" }), right = newEmailBlock("text", { parentId: columns.id, column: 1, text: "Right" });
  design.blocks.push(columns, left, right);
  assert.ok(emailDesignSchema.safeParse(design).success);
  assert.equal(moveEmailBlock(design, columns.id, columns.id, 0), design);
  const copy = duplicateEmailBlock(design, columns.id);
  assert.equal(copy.design.blocks.length, 7);
  assert.ok(emailDesignSchema.safeParse(copy.design).success);
  assert.equal(removeEmailBlock(copy.design, copy.id).blocks.length, 4);
  const html = renderEmailDesign(design).html;
  assert.match(html, /class="email-column"/); assert.match(html, /Left/); assert.match(html, /Right/);
});

test("visual email personalization escapes HTML and preserves links, theme and plain text", () => {
  const design = newEmailDesign("Hello {{first_name}}"); design.theme.contentBackground = "#ffeedd";
  design.blocks.push(newEmailBlock("button", { text: "Shop", href: "https://example.test/products" }));
  const rendered = renderEmailDesign(design, { personalize: value => personalizeCampaign(value, { id: "x", name: '<img src=x onerror="x">', companyName: "Acme", email: "x@example.test" }), utmCampaign: "campaign", preheader: "Preview text" });
  assert.match(rendered.html, /&lt;img/); assert.doesNotMatch(rendered.html, /<img src=x/); assert.match(rendered.html, /utm_campaign=campaign/); assert.match(rendered.html, /#ffeedd/); assert.match(rendered.html, /Preview text/);
  assert.match(rendered.text, /Hello/); assert.match(emailDesignText(design), /Shop/);
});

test("HTML templates remove active content, event handlers and unsafe links", () => {
  const html = sanitizeEmailDesignHtml('<script>steal()</script><iframe src="x"></iframe><a href="javascript:alert(1)" onclick="x()">Safe text</a><img src="data:image/svg+xml;base64,AAAA"><p style="color:red;position:fixed">Hello</p>');
  assert.doesNotMatch(html, /script|steal|iframe|onclick|javascript|svg|position/); assert.match(html, /Safe text/); assert.match(html, /Hello/);
});

test("form and Meta sources qualify without relabeling bounced or invalid contacts", () => {
  for (const source of ["shopify_b2b_form", "shopify_b2b_form_opt_in", "meta_lead_ads"]) {
    assert.equal(isCampaignContactEligible("unverified", source), true);
    assert.equal(isCampaignContactEligible("unknown", source), true);
    assert.equal(isCampaignContactEligible("invalid", source), false);
    assert.equal(isCampaignContactEligible("bounced", source), false);
  }
  assert.equal(isCampaignContactEligible("valid", null), true);
  assert.equal(isCampaignContactEligible("unverified", "historical_customer_email"), false);
});

test("individual contact inclusion and exclusion do not select an entire company", () => {
  const contacts = ["one", "two"].map(id => ({ id, companyId: "company", companyName: "Acme", name: id, email: `${id}@example.test`, eligible: true, unsubscribed: false }));
  assert.deepEqual(selectCampaignRecipients(contacts, new Set(), new Set(), new Set(), new Set(["one"])).recipients.map(item => item.id), ["one"]);
  assert.deepEqual(selectCampaignRecipients(contacts, new Set(["company"]), new Set(), new Set(), new Set(), new Set(["one"])).recipients.map(item => item.id), ["two"]);
});
