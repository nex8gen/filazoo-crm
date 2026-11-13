import assert from "node:assert/strict";
import test from "node:test";
import { assignCampaignSubjects, embeddedCampaignPreheader, subjectVariationKinds, suggestCampaignSubject } from "../lib/campaign-message-tools.ts";
import { campaignConfigSchema, campaignMessageIssues } from "../lib/email-campaigns.ts";
import { newEmailDesign, renderEmailDesign } from "../lib/email-design.ts";

test("A/B recipients receive one stable variant with a balanced split regardless of query order", () => {
  const recipients = Array.from({ length: 101 }, (_, index) => ({ id: String(index), email: `recipient${index}@example.test`, name: "Jane Doe", companyName: "Example" }));
  const config = campaignConfigSchema.parse({ subject: "A", subjectTest: { subjectB: "B" } });
  const first = assignCampaignSubjects(config, recipients, "campaign");
  const second = assignCampaignSubjects(config, [...recipients].reverse(), "campaign");
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(row => row.recipient.id)).size, 101);
  assert.equal(first.filter(row => row.variant === "A").length, 51);
  assert.equal(first.filter(row => row.variant === "B").length, 50);
  assert.ok(first.every(row => row.subject === row.variant));
  const single = assignCampaignSubjects(campaignConfigSchema.parse({ subject: "Only subject" }), recipients, "campaign");
  assert.ok(single.every(row => row.variant === undefined && row.subject === "Only subject"));
  assert.deepEqual(single.map(row => row.recipient.id), recipients.map(row => row.id));
});

test("subject variation controls produce bounded alternatives without unsupported merge fields", () => {
  for (const kind of subjectVariationKinds) {
    const value = suggestCampaignSubject("Your partner update", kind);
    assert.notEqual(value, "Your partner update");
    assert.ok(value.length <= 300);
    assert.equal(suggestCampaignSubject("", kind), "");
  }
  assert.equal(suggestCampaignSubject("{{first_name}}, Partner update", "Personalization vs no personalization"), "Partner update");
  assert.equal(suggestCampaignSubject("Partner update?", "Question vs statement"), "Partner update");
  assert.equal(suggestCampaignSubject("✨ Partner update", "Emoji vs no emoji"), "Partner update");
});

test("review validates the alternate subject and custom plain text", () => {
  const config = campaignConfigSchema.parse({ subject: "A", subjectTest: { subjectB: "{{unsupported}}" }, plainText: "{{other}}" });
  assert.ok(campaignMessageIssues(config, "Body").some(issue => issue.includes("unsupported")));
  assert.ok(campaignMessageIssues({ ...config, subjectTest: { subjectB: "A" } }, "Body").some(issue => issue.includes("different subjects")));
});

test("imported HTML preheaders are recognized without executing template markup", () => {
  assert.equal(embeddedCampaignPreheader(), "");
  assert.equal(embeddedCampaignPreheader(newEmailDesign("<div class='preheader'>Your <strong>partner</strong> update &amp; news</div><p>Visible body</p>", "html")), "Your partner update & news");
  assert.equal(embeddedCampaignPreheader(newEmailDesign("<div style='display: none; max-height: 0'>Hidden preview</div><p>Body</p>", "html")), "Hidden preview");
  assert.equal(embeddedCampaignPreheader(newEmailDesign("<p>Visible body</p>", "html")), "");
  const rendered = renderEmailDesign(newEmailDesign("<div class='preheader'>Hidden preview</div><p>Visible body</p>", "html"));
  assert.match(rendered.html, /display:none;max-height:0;overflow:hidden/);
  assert.equal(rendered.text, "Visible body");
});
