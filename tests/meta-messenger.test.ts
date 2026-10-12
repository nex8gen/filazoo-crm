import test from "node:test";
import assert from "node:assert/strict";

import { buildMetaSignature, normalizeMetaPayload, verifyMetaSignature } from "../lib/meta-messenger.ts";

test("buildMetaSignature creates the expected Meta HMAC SHA256 digest", () => {
  const body = JSON.stringify({ object: "page" });
  const digest = buildMetaSignature("crm-secret", body);
  assert.equal(digest, "baf6b0a2832a77c2350490717bd8fdc6efdb6aaca977dc1c1f293fd6e67ba252");
  assert.equal(verifyMetaSignature("crm-secret", body, `sha256=${digest}`), true);
  assert.equal(verifyMetaSignature("wrong-secret", body, `sha256=${digest}`), false);
});

test("normalizeMetaPayload extracts an inbound Facebook Messenger message", () => {
  const payload = {
    object: "page",
    entry: [{
      id: "page-123",
      time: 1710000000000,
      messaging: [{
        sender: { id: "psid-456" },
        recipient: { id: "page-123" },
        timestamp: 1710000000000,
        message: { mid: "mid.abc123", text: "Hi, is this still available?" },
      }],
    }],
  };

  const result = normalizeMetaPayload(payload);
  assert.equal(result.leads.length, 0);
  assert.deepEqual(result.messages, [{
    id: "mid.abc123",
    threadId: "psid-456",
    pageId: "page-123",
    senderId: "psid-456",
    recipientId: "page-123",
    direction: "inbound",
    type: "text",
    body: "Hi, is this still available?",
    timestamp: "2024-03-09T16:00:00.000Z",
    customerName: "psid-456",
    rawPayload: payload.entry[0].messaging[0],
  }]);
});

test("normalizeMetaPayload extracts Page leadgen events", () => {
  const value = {
    leadgen_id: "lead-1",
    page_id: "page-123",
    form_id: "form-2",
    ad_id: "ad-3",
    adgroup_id: "campaign-4",
    created_time: 1710000000,
  };
  const result = normalizeMetaPayload({
    object: "page",
    entry: [{ id: "page-123", changes: [{ field: "leadgen", value }] }],
  });
  assert.equal(result.messages.length, 0);
  assert.deepEqual(result.leads, [{
    leadgenId: "lead-1",
    pageId: "page-123",
    formId: "form-2",
    adId: "ad-3",
    adGroupId: "campaign-4",
    createdTime: "2024-03-09T16:00:00.000Z",
    rawPayload: value,
  }]);
});

test("normalizeMetaPayload ignores WhatsApp payloads", () => {
  assert.deepEqual(normalizeMetaPayload({ object: "whatsapp_business_account", entry: [] }), { messages: [], leads: [] });
});
