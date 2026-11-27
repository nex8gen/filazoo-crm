import assert from "node:assert/strict";
import test from "node:test";
import { describeDevice, formatSecurityDate, securityError } from "../lib/account-security.ts";
import { passkeyBrowserError, passkeyOrigin } from "../lib/passkey-config.ts";

test("device labels distinguish Edge, mobile Safari, Chrome and unknown browsers", () => {
  assert.deepEqual(describeDevice(null), { name: "Unknown device", kind: "desktop" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (Windows NT 10.0) Chrome/131 Safari/537 Edg/131"), { name: "Edge on Windows", kind: "desktop" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605 Version/18 Mobile Safari/604"), { name: "Safari on iPhone", kind: "mobile" });
  assert.deepEqual(describeDevice("Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile Safari/537"), { name: "Chrome on Android", kind: "mobile" });
});

test("security dates render consistently during SSR and hydration", () => {
  assert.equal(formatSecurityDate("2026-11-27T14:00:00+08:00"), formatSecurityDate("2026-11-27T06:00:00Z"));
  assert.match(formatSecurityDate("2026-11-27T06:00:00Z"), /Nov 27, 2026/);
});

test("security errors explain safe recovery without leaking provider response bodies", () => {
  assert.match(securityError({ code: "mfa_verification_failed", message: "secret" }, "Failed"), /invalid or expired/);
  assert.match(securityError({ code: "passkey_disabled" }, "Failed"), /not enabled/);
  assert.match(securityError({ status: 429 }, "Failed"), /Too many attempts/);
  assert.equal(securityError({ message: "private response" }, "Failed"), "Failed");
});

test("passkeys require the configured origin, HTTPS and a WebAuthn browser", () => {
  assert.equal(passkeyBrowserError({ origin: passkeyOrigin, secure: true, supported: true }), null);
  assert.match(passkeyBrowserError({ origin: "http://localhost:3000", secure: true, supported: true })!, /Open that address/);
  assert.match(passkeyBrowserError({ origin: passkeyOrigin, secure: false, supported: true })!, /HTTPS/);
  assert.match(passkeyBrowserError({ origin: passkeyOrigin, secure: true, supported: false })!, /browser/);
});
