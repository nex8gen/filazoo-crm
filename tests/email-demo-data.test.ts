import assert from "node:assert/strict";
import test from "node:test";
import { isSampleEmailSubject } from "../lib/data/crm.ts";
import { buildInboxEmailItems } from "../lib/email-inbox.ts";

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
});
