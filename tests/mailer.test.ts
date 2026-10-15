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
  assert.equal(items.length, 2);
});
