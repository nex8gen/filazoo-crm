import assert from "node:assert/strict";
import test from "node:test";
import { groupEmailConversations, groupEmailsByThread, replyReferences, replyTarget, threadKeyForEmail } from "../lib/email-threading.ts";

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

test("joins immediate-parent replies to a CRM thread even with incomplete References and reversed input", () => {
  const root = { id: "root", messageId: "<root@test>", threadId: "shopify:lead" };
  const sent = { id: "sent", messageId: "<sent@test>", inReplyTo: "<root@test>", references: ["<root@test>"], threadId: "shopify:lead" };
  const reply = { id: "reply", messageId: "<reply@test>", inReplyTo: "<sent@test>" };
  assert.equal(groupEmailsByThread([reply, sent, root]).size, 1);
  assert.equal(groupEmailsByThread([root, sent, reply]).size, 1);
});

test("reply recipient follows the latest inbound Reply-To after our own sent follow-up", () => {
  const target = replyTarget([
    { id: "in", direction: "inbound", contact: "sender@test.com", replyTo: "sales@test.com", timestamp: "2026-10-22T01:00:00Z" },
    { id: "out", direction: "outbound", contact: "old-recipient@test.com", timestamp: "2026-10-22T02:00:00Z" },
  ]);
  assert.equal(target?.recipient, "sales@test.com");
  assert.equal(target?.parent.id, "in");
});

test("a sent-only conversation continues to its recipient", () => {
  assert.equal(replyTarget([{ id: "out", direction: "outbound", contact: "buyer@test.com", timestamp: "2026-10-22T02:00:00Z" }])?.recipient, "buyer@test.com");
  assert.equal(replyTarget([]), null);
});

test("References sent back to providers preserve opaque message-ID casing", () => {
  assert.deepEqual(replyReferences({ id: "reply", messageId: "<ParentABC@example.com>", references: ["<RootABC@example.com>"] }), ["<RootABC@example.com>", "<ParentABC@example.com>"]);
});

test("attaches a legacy sent reply to its earlier inbound conversation", () => {
  const inbound = { id: "inbound", direction: "inbound" as const, subject: "Hi", contact: "buyer@example.com", timestamp: "2026-10-15T10:46:00Z", messageId: "<inbound@example.com>" };
  const legacyReply = { id: "sent", direction: "outbound" as const, subject: "Re: Hi", contact: "buyer@example.com", timestamp: "2026-10-15T14:24:00Z", messageId: "<sent@example.com>" };
  const unrelatedInbound = { id: "new", direction: "inbound" as const, subject: "Hi", contact: "buyer@example.com", timestamp: "2026-10-15T15:00:00Z", messageId: "<new@example.com>" };

  const threads = [...groupEmailConversations([inbound, legacyReply, unrelatedInbound]).values()];
  assert.deepEqual(threads.map((thread) => thread.map((message) => message.id)), [["inbound", "sent"], ["new"]]);
});
