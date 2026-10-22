import assert from "node:assert/strict";
import test from "node:test";
import { splitQuotedEmail } from "../lib/email-content.ts";

test("keeps a customer's new text above Gmail quoted history", () => {
  const body = "What is the shipping cost?\r\nPlease let me know\r\n\r\nOn Thu, 22 Oct 2026 at 10:05, <sales@test.com> wrote:\r\n\r\nHi, here is our catalog.";
  const split = splitQuotedEmail(body);
  assert.equal(split.current, "What is the shipping cost?\nPlease let me know");
  assert.match(split.quoted!, /here is our catalog/);
});

test("retains ordinary rich email text and quote-only messages", () => {
  const body = "Hello,\nPlease quote 50 spools.\nThanks!";
  assert.deepEqual(splitQuotedEmail(body), { current: body, quoted: null });
  assert.deepEqual(splitQuotedEmail("> Quoted only"), { current: "> Quoted only", quoted: null });
});

test("supports Outlook original-message separators", () => {
  assert.equal(splitQuotedEmail("Thanks\n\n-----Original Message-----\nFrom: buyer@test.com").current, "Thanks");
});
