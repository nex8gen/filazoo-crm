import test from "node:test";
import assert from "node:assert/strict";
import { describeMailboxConnectionError } from "../lib/mailbox-connection.ts";

test("explains an SMTP greeting timeout as a network or port problem", () => {
  const message = describeMailboxConnectionError("SMTP", Object.assign(new Error("Greeting never received"), {
    code: "ETIMEDOUT",
  }));

  assert.match(message, /^SMTP server did not respond\./);
  assert.match(message, /port 465/);
  assert.match(message, /network is blocking outbound mail ports/);
});

test("labels IMAP authentication errors without exposing implementation details", () => {
  const message = describeMailboxConnectionError("IMAP", Object.assign(new Error("Invalid credentials"), {
    code: "AUTHENTICATIONFAILED",
  }));

  assert.match(message, /^IMAP authentication failed\./);
  assert.match(message, /app password/);
});

test("explains IMAP certificate failures without recommending insecure TLS", () => {
  const message = describeMailboxConnectionError("IMAP", new Error("self-signed certificate"));

  assert.match(message, /^IMAP TLS certificate verification failed\./);
  assert.match(message, /will not disable certificate verification/);
});
