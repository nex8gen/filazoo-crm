import assert from "node:assert/strict";
import test from "node:test";
import { groupEmailConversations, groupEmailsByThread, replyReferences, threadKeyForEmail } from "../lib/email-threading.ts";

test("groups replies by RFC message headers and not by subject alone", () => {
  const original = { id: "one", subject: "Pricing", messageId: "<root@example.com>" };
  const reply = {
    id: "two",
    subject: "Re: Pricing",
    messageId: "<reply@example.com>",
    inReplyTo: "<root@example.com>",
    references: ["<root@example.com>"],
  };
  const unrelatedSameSubject = { id: "three", subject: "Pricing", messageId: "<new@example.com>" };

  const threads = [...groupEmailsByThread([original, reply, unrelatedSameSubject]).values()];
  assert.deepEqual(threads.map((thread) => thread.map((message) => message.id)), [["one", "two"], ["three"]]);
  assert.equal(threadKeyForEmail(original), threadKeyForEmail(reply));
  assert.notEqual(threadKeyForEmail(original), threadKeyForEmail(unrelatedSameSubject));
});

test("builds the References chain for a CRM reply", () => {
  assert.deepEqual(replyReferences({
    id: "reply",
    messageId: "<second@example.com>",
    references: ["<root@example.com>"],
  }), ["<root@example.com>", "<second@example.com>"]);
});

test("attaches a legacy sent reply to its earlier inbound conversation", () => {
  const inbound = { id: "inbound", direction: "inbound" as const, subject: "Hi", contact: "buyer@example.com", timestamp: "2026-10-15T10:46:00Z", messageId: "<inbound@example.com>" };
  const legacyReply = { id: "sent", direction: "outbound" as const, subject: "Re: Hi", contact: "buyer@example.com", timestamp: "2026-10-15T14:24:00Z", messageId: "<sent@example.com>" };
  const unrelatedInbound = { id: "new", direction: "inbound" as const, subject: "Hi", contact: "buyer@example.com", timestamp: "2026-10-15T15:00:00Z", messageId: "<new@example.com>" };

  const threads = [...groupEmailConversations([inbound, legacyReply, unrelatedInbound]).values()];
  assert.deepEqual(threads.map((thread) => thread.map((message) => message.id)), [["inbound", "sent"], ["new"]]);
});
