import test from "node:test";
import assert from "node:assert/strict";
import twilio from "twilio";
import { normalizeTwilioMessage, verifyTwilioSignature } from "../lib/twilio-messaging.ts";

test("Twilio signature binds the exact URL and every form parameter", () => {
  const url = "https://crm.example.com/api/twilio/webhook";
  const params = { AccountSid: "ACtest", Body: "Hello", ExtraFutureField: "value" };
  const signature = twilio.getExpectedTwilioSignature("token", url, params);
  assert.equal(verifyTwilioSignature("token", signature, url, params), true);
  assert.equal(verifyTwilioSignature("token", signature, url, { ...params, Body: "Forged" }), false);
  assert.equal(verifyTwilioSignature("token", signature, url + "?changed=1", params), false);
  assert.equal(verifyTwilioSignature("token", null, url, params), false);
});

test("WhatsApp and Messenger messages retain channel and customer identifiers", () => {
  for (const [prefix, channel] of [["whatsapp:", "whatsapp"], ["messenger:", "facebook"]]) {
    const message = normalizeTwilioMessage({ From: `${prefix}123`, To: `${prefix}456`, MessageSid: "SMtest", Body: "Hello", ProfileName: "Customer" });
    assert.equal(message?.channel, channel);
    assert.equal(message?.customerId, "123");
    assert.equal(message?.pageId, "456");
    assert.equal(message?.body, "Hello");
  }
});

test("Reject SMS, mixed channels, and missing message IDs", () => {
  assert.equal(normalizeTwilioMessage({ From: "+123", To: "+456", MessageSid: "SMtest" }), null);
  assert.equal(normalizeTwilioMessage({ From: "whatsapp:123", To: "messenger:456", MessageSid: "SMtest" }), null);
  assert.equal(normalizeTwilioMessage({ From: "whatsapp:123", To: "whatsapp:456" }), null);
});
