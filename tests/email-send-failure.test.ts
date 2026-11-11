import assert from "node:assert/strict";
import test from "node:test";
import { emailFailedBeforeSubmission } from "../lib/email-send-failure.ts";

test("only positive pre-submission evidence permits an SMTP retry", () => {
  assert.equal(emailFailedBeforeSubmission("Client network socket disconnected before secure TLS connection was established"), true);
  for (const command of ["AUTH LOGIN", "STARTTLS", "MAIL FROM", "RCPT TO"]) {
    assert.equal(emailFailedBeforeSubmission({ command, message: "Rejected" }), true);
  }
  assert.equal(emailFailedBeforeSubmission({ command: "CONN", message: "connect ECONNREFUSED 127.0.0.1:465" }), true);
  for (const error of [null, "Delivery was interrupted", { command: "CONN", message: "Connection closed unexpectedly" }, { command: "CONN", code: "ESOCKET", message: "Server closed the connection" }, { command: "DATA", message: "Timeout" }, { command: "API", message: "Stream error" }]) {
    assert.equal(emailFailedBeforeSubmission(error), false);
  }
});
