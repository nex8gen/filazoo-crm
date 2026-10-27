import assert from "node:assert/strict";
import test from "node:test";
import { isSampleEmailSubject } from "../lib/data/crm.ts";
import { buildInboxEmailItems, filterCustomerReplyMessages } from "../lib/email-inbox.ts";

test("an empty mailbox does not inject sample emails", () => {
  assert.deepEqual(buildInboxEmailItems(), []);
});

test("seeded sample subjects are excluded without hiding normal or untitled mail", () => {
  assert.equal(isSampleEmailSubject("[SAMPLE] Reliable PLA supply"), true);
  assert.equal(isSampleEmailSubject("Re: [sample] Reliable PLA supply"), true);
  assert.equal(isSampleEmailSubject("Reliable PLA supply"), false);
  assert.equal(isSampleEmailSubject(null), false);
});

test("CRM drafts and replies become an inbox-ready timeline", () => {
  const items = buildInboxEmailItems({
    drafts: [
      { id: "draft-1", company: "Proto Labs", contact: "Marie Vogel", subject: "PETG pricing", preview: "Can you share pricing?", step: 1, scheduledFor: "Today", status: "Needs approval" },
    ],
    replies: [
      { id: "reply-1", company: "Proto Labs", contact: "Marie Vogel", subject: "Re: PETG pricing", body: "Thanks, we can review the quote.", receivedAt: "2026-10-14T09:00:00Z" },
    ],
  });

  assert.equal(items[0].direction, "inbound");
  assert.equal(items[1].direction, "outbound");
  assert.equal(items[0].company, "Proto Labs");
  assert.ok(items.some((item) => item.subject.includes("PETG pricing")));
  assert.ok(items.every((item) => item.demo === false));
});

test("live mailbox and Shopify messages retain their provenance instead of becoming demo mail", () => {
  const items = buildInboxEmailItems({ inbound: [
    { id: "mailbox-1", source: "mailbox", contact: "buyer@example.com", body: "Please quote PLA." },
    { id: "shopify-1", source: "shopify", contact: "lead@example.com", body: "Create our company profile." },
    { id: "sample-1", source: "crm", demo: true, body: "Sample message" },
  ] });
  assert.equal(items.find((item) => item.id === "mailbox-1")?.demo, false);
  assert.equal(items.find((item) => item.id === "shopify-1")?.demo, false);
  assert.equal(items.find((item) => item.id === "sample-1")?.demo, true);
});

test("team inbox filtering keeps CRM contacts and replies to CRM-sent mail", () => {
  const inbound = buildInboxEmailItems({ inbound: [
    { id: "known", contact: "buyer@example.com", subject: "Pricing", body: "Please quote", messageId: "<known@example.com>", timestamp: "2026-10-21T11:00:00Z" },
    { id: "threaded", contact: "alias@example.net", subject: "Re: Quote", body: "Thank you", inReplyTo: "<sent@example.com>", timestamp: "2026-10-21T10:00:00Z" },
    { id: "sent-recipient", contact: "prospect@example.io", subject: "Re: Introduction", body: "Interested", timestamp: "2026-10-21T09:00:00Z" },
    { id: "noise", contact: "newsletter@example.org", subject: "Weekly digest", body: "News", timestamp: "2026-10-21T08:00:00Z" },
  ] }).filter((message) => message.direction === "inbound");
  const sent = [{
    id: "sent", direction: "outbound" as const, status: "Sent", subject: "Quote", contact: "buyer@example.com",
    company: "Example", preview: "Quote attached", body: "Quote attached", timestamp: "2026-10-21T07:00:00Z",
    messageId: "<sent@example.com>",
  }, {
    id: "sent-prospect", direction: "outbound" as const, status: "Sent", subject: "Introduction", contact: "prospect@example.io",
    company: "Prospect", preview: "Hello", body: "Hello", timestamp: "2026-10-21T07:30:00Z",
  }];

  assert.deepEqual(
    filterCustomerReplyMessages(inbound, ["buyer@example.com"], sent).map((message) => message.id),
    ["known", "threaded", "sent-recipient"],
  );
});
