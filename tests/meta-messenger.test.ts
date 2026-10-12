import test from "node:test";
import assert from "node:assert/strict";

import { buildMetaSignature, normalizeMetaPayload } from "../lib/meta-messenger.ts";

test("buildMetaSignature creates the expected HMAC SHA256 digest", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const secret = "crm-secret";

  const digest = buildMetaSignature(secret, body);

  assert.equal(digest, "dc7b281a45f2f236916f0b4ba7cbe6bbf9ae8e35f46a3e51435ef58402539fc7");
});

test("normalizeMetaPayload extracts customer and message details", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                display_phone_number: "+1234567890",
                phone_number_id: "123456",
              },
              contacts: [{ profile: { name: "Ava" }, wa_id: "15551234567" }],
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.abc123",
                  timestamp: "1710000000",
                  type: "text",
                  text: { body: "Hi, is this still available?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const result = normalizeMetaPayload(payload);

  assert.deepEqual(result, [
    {
      id: "wamid.abc123",
      from: "15551234567",
      type: "text",
      body: "Hi, is this still available?",
      timestamp: "1710000000",
      customerName: "Ava",
      phoneNumberId: "123456",
      displayPhoneNumber: "+1234567890",
    },
  ]);
});
