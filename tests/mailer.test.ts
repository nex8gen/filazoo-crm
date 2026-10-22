import test from "node:test";
import assert from "node:assert/strict";
import { buildInboxEmailItems } from "../lib/email-inbox.ts";

test("merges real IMAP messages into the inbox list", () => {
  const items = buildInboxEmailItems({
    inbound: [
      {
        id: "imap-1",
        direction: "inbound",
        status: "Received",
        subject: "Meeting follow-up",
        contact: "buyer@company.com",
        company: "Northwind",
        preview: "Thanks for the meeting notes",
        body: "Thanks for the meeting notes",
        html: '<table><tr><td><a href="https://company.example/quote"><img src="https://company.example/quote.png" alt="Quote"></a></td></tr></table>',
        timestamp: "2026-10-14T09:00:00.000Z",
      },
    ],
    replies: [
      {
        id: "reply-1",
        contact: "hello@other.com",
        company: "Acme",
        subject: "New inbound email",
        body: "Earlier note",
        receivedAt: "2026-10-14T08:00:00.000Z",
      },
    ],
  });

  assert.equal(items[0].id, "imap-1");
  assert.equal(items[0].direction, "inbound");
  assert.match(items[0].html || "", /<table>/);
  assert.match(items[0].html || "", /<img /);
  assert.equal(items.length, 2);
});

test("deduplicates the saved CRM reply against its IMAP message and preserves Reply-To", () => {
  const items = buildInboxEmailItems({
    inbound: [{ id: "imap-one", messageId: "<one@test>", contact: "sender@test.com", replyTo: "reply@test.com", body: "Hello" }],
    replies: [{ id: "crm-one", messageId: "<one@test>", threadId: "old-key", contact: "sender@test.com", company: "Buyer", subject: "Enquiry", body: "Hello", receivedAt: "2026-10-22T01:00:00Z" }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].replyTo, "reply@test.com");
});
