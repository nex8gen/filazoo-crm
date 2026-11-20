import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { digest, oauthClientId, opaqueToken, openGrant, pkceChallenge, sealGrant, singleParams, subjectFor, validateAuthorization } from "../lib/alipay-auth/protocol.ts";

const secret = opaqueToken();
test("Alipay browser state is authenticated, confidential, browser bound and time limited", () => {
  const grant = { state: opaqueToken(), upstreamState: "supabase-signed-state", challenge: digest("verifier"), expires: Date.now() + 599_000 };
  const sealed = sealGrant(grant, secret);
  assert.equal(sealed.includes(grant.upstreamState), false);
  assert.deepEqual(openGrant(sealed, grant.state, secret), grant);
  assert.throws(() => openGrant(sealed, opaqueToken(), secret));
  assert.throws(() => openGrant(sealed, grant.state, opaqueToken()));
  assert.throws(() => openGrant(sealed, grant.state, secret, grant.expires));
  const bytes = Buffer.from(sealed, "base64url"); bytes[30] ^= 1;
  assert.throws(() => openGrant(bytes.toString("base64url"), grant.state, secret));
  assert.throws(() => openGrant("", grant.state, secret));
});
test("authorization permits only Supabase's exact callback and S256", () => {
  const callback = "https://project.supabase.co/auth/v1/callback";
  const params = { client_id: oauthClientId, redirect_uri: callback, response_type: "code", code_challenge_method: "S256", code_challenge: digest("verifier"), state: "signed-state" };
  assert.doesNotThrow(() => validateAuthorization(params, callback));
  for (const mutation of [{ client_id: "attacker" }, { redirect_uri: callback + "/evil" }, { redirect_uri: "https://evil.example/callback" }, { code_challenge_method: "plain" }, { response_type: "token" }, { state: "" }, { code_challenge: "short" }]) assert.throws(() => validateAuthorization({ ...params, ...mutation }, callback));
});
test("duplicate OAuth parameters are rejected instead of ambiguous parsing", () => {
  assert.throws(() => singleParams(new URLSearchParams("state=a&state=b")));
  assert.throws(() => singleParams(new URLSearchParams({ code: "a".repeat(8193) })));
  assert.equal(singleParams(new URLSearchParams("code=valid")).code, "valid");
});
test("PKCE conforms to RFC 7636 and rejects weak verifiers", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  for (const verifier of ["short", " ".repeat(43), "a".repeat(129)]) assert.throws(() => pkceChallenge(verifier));
});
test("only verified stable Alipay IDs produce a scoped pseudonymous subject", () => {
  const id = { open_id: "test-open-id-12345678", user_id: "2088000000000001" };
  const subject = subjectFor("2021007121675450", id, secret);
  assert.equal(subject.length, 43);
  assert.equal(subjectFor("2021007121675450", id, secret), subject);
  assert.notEqual(subjectFor("2021007121675451", id, secret), subject);
  assert.notEqual(subjectFor("2021007121675450", { ...id, open_id: "test-open-id-12345679" }, secret), subject);
  assert.throws(() => subjectFor("2021007121675450", { user_id: "nickname" }, secret));
});
test("provider exchange verifies RSA signatures without depending on merchant payment activation", () => {
  const source = readFileSync("lib/alipay-auth/server.ts", "utf8");
  assert.match(source, /alipay\.system\.oauth\.token/);
  assert.match(source, /validateSign: true/);
  assert.doesNotMatch(source, /ALIPAY_SELLER_ID|ALIPAY_PAYMENTS_ENABLED|billing\/alipay/);
});
