import test from "node:test";
import assert from "node:assert/strict";
import { buildInvitationConfirmationUrl, buildInvitationEmail } from "../lib/auth-invitation.ts";

test("builds invite acceptance links on the configured application origin", () => {
  const url = new URL(buildInvitationConfirmationUrl("https://crm.filazoosupply.com", "secret token", "invite"));

  assert.equal(url.origin, "https://crm.filazoosupply.com");
  assert.equal(url.pathname, "/auth/confirm");
  assert.equal(url.searchParams.get("token_hash"), "secret token");
  assert.equal(url.searchParams.get("type"), "invite");
  assert.equal(url.searchParams.get("next"), "/update-password");
});

test("escapes invitation content used in HTML email", () => {
  const email = buildInvitationEmail('R&D <Admin>', "https://example.com/auth/confirm?a=1&b=2");

  assert.match(email.html, /R&amp;D &lt;Admin&gt;/);
  assert.match(email.html, /a=1&amp;b=2/);
  assert.doesNotMatch(email.html, /R&D <Admin>/);
  assert.match(email.text, /R&D <Admin>/);
});
