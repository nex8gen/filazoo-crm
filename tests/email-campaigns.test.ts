import assert from "node:assert/strict";
import test from "node:test";
import { campaignConfigSchema, campaignLocalDate, campaignMessageIssues, campaignMessageWarnings, personalizeCampaign, selectCampaignRecipients } from "../lib/email-campaigns.ts";
import { newEmailBlock, newEmailDesign } from "../lib/email-design.ts";
import { marketingAssetInputSchema, newMarketingAsset } from "../lib/marketing-assets.ts";

test("campaign drafts preserve setup, audience, message, and scheduling settings", () => {
  const config = campaignConfigSchema.parse({ tags: ["Product launch"], includeSegments: ["all"], subject: "Hello {{first_name}}", senderName: "Filazoo", mailboxId: "mailbox", sendMode: "scheduled", scheduledAt: "2026-12-01T08:30:00+08:00" });
  const asset = marketingAssetInputSchema.parse({ ...newMarketingAsset("factory_sale", 2026), campaignConfig: config, message: "Hello {{company}}" });
  assert.deepEqual(asset.campaignConfig, config);
  assert.equal(config.smartSending, true);
  assert.equal(config.channel, "email");
  assert.equal(campaignConfigSchema.safeParse({ channel: "sms" }).success, false);
  assert.equal(campaignConfigSchema.safeParse({ senderName: "Bad\r\nBcc: victim@example.com" }).success, false);
  assert.equal(campaignConfigSchema.safeParse({ replyTo: "bad-address" }).success, false);
  assert.equal(campaignLocalDate(new Date("2026-11-12T17:00:00Z")), "2026-11-13");
});

test("audience selection deduplicates, applies exclusions, and blocks unsubscribed duplicate addresses", () => {
  const contact = { id: "one", email: "buyer@example.test", companyId: "a", companyName: "A", name: "Buyer", eligible: true, unsubscribed: false };
  const contacts = [contact, { ...contact, id: "duplicate", email: "BUYER@example.test" }, { ...contact, id: "two", email: "other@example.test", companyId: "b" }, { ...contact, id: "three", email: "recent@example.test" }, { ...contact, id: "four", email: "invalid@example.test", eligible: false }];
  const result = selectCampaignRecipients(contacts, new Set(["a", "b"]), new Set(["b"]), new Set(["recent@example.test"]));
  assert.deepEqual(result.recipients.map(item => item.email), ["buyer@example.test"]);
  assert.equal(result.recent, 1);
  const unsubscribed = selectCampaignRecipients([...contacts, { ...contact, id: "unsubscribed", unsubscribed: true }], new Set(["a"]), new Set(), new Set());
  assert.ok(!unsubscribed.recipients.some(item => item.email === contact.email));
  assert.deepEqual(selectCampaignRecipients(contacts, new Set(), new Set(), new Set()).recipients, []);
});

test("review blocks incomplete senders and unsupported template placeholders", () => {
  const config = campaignConfigSchema.parse({ subject: "Hello", mailboxId: "sender" });
  const mailbox = { id: "sender", name: "Sender", email: "sender@example.test", available: true };
  assert.deepEqual(campaignMessageIssues(config, "Hello {{first_name}} at {{company}}", mailbox), []);
  assert.match(campaignMessageIssues(config, "Hello {{customer.unknown}}", mailbox).join(), /unsupported/);
  assert.match(campaignMessageIssues(config, "Hello", { ...mailbox, available: false }).join(), /connected sender/);
  assert.match(campaignMessageIssues({ ...config, useSenderReplyTo: false }, "Hello", mailbox).join(), /reply-to/);
  assert.equal(personalizeCampaign("Hello {{first_name}} from {{company}}", { id: "one", name: "Jane Doe", companyName: "Acme", email: "jane@example.test" }), "Hello Jane from Acme");
});

test("missing or invalid button and video links are advisory and clear when corrected", () => {
  const mailbox = { id: "sender", name: "Sender", email: "sender@example.test", available: true };
  for (const type of ["button", "video"] as const) {
    for (const href of ["", "not-a-url", "javascript:alert(1)"]) {
      const emailDesign = newEmailDesign("Hello");
      const block = newEmailBlock(type, { href });
      emailDesign.blocks.push(block);
      const config = campaignConfigSchema.parse({ subject: "Hello", mailboxId: mailbox.id, emailDesign });
      assert.deepEqual(campaignMessageIssues(config, "Hello", mailbox), []);
      assert.equal(campaignMessageWarnings(config).length, 1);
      assert.match(campaignMessageWarnings(config)[0], /You can continue/);
      config.emailDesign!.blocks.find(item => item.id === block.id)!.href = "https://example.test/shop";
      assert.deepEqual(campaignMessageWarnings(config), []);
    }
  }
  assert.deepEqual(campaignMessageWarnings(campaignConfigSchema.parse({})), []);
});
