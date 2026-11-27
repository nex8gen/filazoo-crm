import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Explicit live integration check. Uses one disposable confirmed account, never
// an existing user's credentials or devices. No secrets are logged or persisted.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publicKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const secret = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;
assert.ok(url && publicKey && secret, "Supabase environment is required");
const origin = process.env.NEXT_PUBLIC_PASSKEY_ORIGIN || "https://crm.filazoosupply.com";
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-crm-control": "1" } } });
const client = () => createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "User-Agent": "Filazoo security verification / Windows" } } });
const checked: string[] = [];
const ok = (name: string) => { checked.push(name); console.log(`PASS ${name}`); };
const requireSuccess = (result: { error: { code?: string; status?: number } | null }, stage: string) => {
  if (result.error) throw new Error(`${stage} failed (${result.error.code || result.error.status || "unknown"})`);
};

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest(); const offset = hash[hash.length - 1] & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

// Minimal CBOR for a test-only, in-memory WebAuthn authenticator. The real app
// delegates credentials and all verification to the browser and Supabase Auth.
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof value === "number") return head(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (typeof value === "string") { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error("Unsupported test CBOR value");
}

let userId: string | undefined;
try {
  const email = `security-verification-${randomBytes(10).toString("hex")}@example.invalid`;
  const password = `Verify!${randomBytes(24).toString("hex")}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  requireSuccess(created, "Create verification account"); userId = created.data.user!.id;
  const first = client(); const second = client();
  requireSuccess(await first.auth.signInWithPassword({ email, password }), "Password sign-in");
  requireSuccess(await second.auth.signInWithPassword({ email, password }), "Second device sign-in");
  async function sessionId(auth: SupabaseClient) {
    const claims = await auth.auth.getClaims(); requireSuccess(claims, "Verify session claims");
    return String(claims.data!.claims.session_id);
  }
  const firstId = await sessionId(first); const secondId = await sessionId(second);
  const args = { p_user_id: userId, p_session_id: firstId };
  const devices = await admin.rpc("list_account_sessions", args); requireSuccess(devices, "List sessions");
  assert.equal(devices.data.length, 2); assert.equal(devices.data.filter((s: { current: boolean }) => s.current).length, 1);
  ok("device sessions list only this account and identify the current session");
  const denied = await first.rpc("list_account_sessions", args); assert.ok(denied.error);
  ok("browser credentials cannot invoke privileged session readers");

  const enrollment = await first.auth.mfa.enroll({ factorType: "totp", issuer: "Filazoo", friendlyName: "Verification authenticator" });
  requireSuccess(enrollment, "Enroll authenticator");
  const factor = enrollment.data!;
  const unverified = await admin.rpc("read_account_security", args).single<{ mfa_required: boolean }>(); requireSuccess(unverified, "Read enrollment state");
  assert.equal(unverified.data!.mfa_required, false);
  const verified = await first.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) });
  requireSuccess(verified, "Verify authenticator");
  const state = await admin.rpc("read_account_security", args).single<{ mfa_required: boolean }>(); requireSuccess(state, "Read MFA state"); assert.equal(state.data!.mfa_required, true);
  const claims = await first.auth.getClaims(); assert.equal(claims.data!.claims.aal, "aal2");
  ok("authenticator enrollment becomes active only after a correct code and upgrades to AAL2");

  requireSuccess(await second.auth.signInWithPassword({ email, password }), "New AAL1 sign-in");
  const pendingId = await sessionId(second);
  const pending = await admin.rpc("read_secure_workspace_session", { p_user_id: userId, p_session_id: pendingId, p_workspace_id: null }).single<{ mfa_required: boolean }>();
  requireSuccess(pending, "Read pending sign-in"); assert.equal(pending.data!.mfa_required, true);
  const pendingClaims = await second.auth.getClaims(); assert.equal(pendingClaims.data!.claims.aal, "aal1");
  ok("future password logins require two-step verification from fresh server state");

  const options = await first.auth.passkey.startRegistration(); requireSuccess(options, "Start passkey registration");
  const registration = options.data!;
  const rpId = registration.options.rp.id!;
  const { privateKey, publicKey: credentialKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = credentialKey.export({ format: "jwk" });
  const credentialId = randomBytes(32); const id = credentialId.toString("base64url");
  const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]));
  const rpHash = createHash("sha256").update(rpId).digest();
  const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credentialId.length]), credentialId, cose]);
  const clientData = (type: string, challenge: string, address = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: address, crossOrigin: false }));
  const registered = await first.auth.passkey.verifyRegistration({ challengeId: registration.challenge_id, credential: {
    id, rawId: id, type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
    response: { clientDataJSON: clientData("webauthn.create", registration.options.challenge).toString("base64url"), attestationObject: cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])).toString("base64url"), transports: ["internal"] },
  } });
  requireSuccess(registered, "Register signed passkey");
  const passkeyId = registered.data!.id;
  const listed = await first.auth.passkey.list(); requireSuccess(listed, "List passkeys"); assert.equal(listed.data!.length, 1);
  requireSuccess(await first.auth.passkey.update({ passkeyId, friendlyName: "Verification device" }), "Rename passkey");
  ok("passkey registration, listing and rename work with a real WebAuthn public key");

  const passkeyLogin = client();
  const loginOptions = await passkeyLogin.auth.passkey.startAuthentication(); requireSuccess(loginOptions, "Start passkey sign-in");
  const auth = loginOptions.data!;
  const assertionData = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);
  const loginClientData = clientData("webauthn.get", auth.options.challenge);
  const signature = sign("sha256", Buffer.concat([assertionData, createHash("sha256").update(loginClientData).digest()]), privateKey);
  const credential = { id, rawId: id, type: "public-key" as const, clientExtensionResults: {}, response: { clientDataJSON: loginClientData.toString("base64url"), authenticatorData: assertionData.toString("base64url"), signature: signature.toString("base64url"), userHandle: registration.options.user.id } };
  const signedIn = await passkeyLogin.auth.passkey.verifyAuthentication({ challengeId: auth.challenge_id, credential });
  requireSuccess(signedIn, "Verify signed passkey sign-in"); assert.ok(signedIn.data); assert.equal(signedIn.data.user!.id, userId); assert.ok(signedIn.data.session);
  ok("passkey signatures create a genuine session for the correct account");
  const replay = await client().auth.passkey.verifyAuthentication({ challengeId: auth.challenge_id, credential }); assert.ok(replay.error);
  ok("used WebAuthn challenges cannot be replayed");
  const pkState = await admin.rpc("read_account_security", { p_user_id: userId, p_session_id: await sessionId(passkeyLogin) }).single<{ mfa_required: boolean }>(); requireSuccess(pkState, "Read passkey session MFA state"); assert.equal(pkState.data!.mfa_required, true);
  ok("passkey login retains the account's two-step verification requirement");
  requireSuccess(await first.auth.passkey.delete({ passkeyId }), "Remove passkey");
  const empty = await first.auth.passkey.list(); requireSuccess(empty, "Verify removed passkey"); assert.equal(empty.data!.length, 0);
  ok("removed passkeys disappear from account credentials");

  const revoked = await admin.rpc("revoke_account_sessions", { ...args, p_scope: "others", p_target_id: null }); requireSuccess(revoked, "Revoke other devices");
  const after = await admin.rpc("read_account_security", { p_user_id: userId, p_session_id: pendingId }); requireSuccess(after, "Read revoked session"); assert.equal(after.data.length, 0);
  assert.equal((await admin.rpc("list_account_sessions", args)).data.length, 1);
  ok("other-device revocation blocks existing JWT sessions immediately and keeps the current session");
  requireSuccess(await first.auth.mfa.unenroll({ factorId: factor.id }), "Remove authenticator");
  assert.equal((await admin.rpc("read_account_security", args).single<{ mfa_required: boolean }>()).data!.mfa_required, false);
  ok("authenticator removal clears the live MFA requirement");
  requireSuccess(await admin.rpc("revoke_account_sessions", { ...args, p_scope: "all", p_target_id: null }), "End all sessions");
  assert.equal((await admin.rpc("read_account_security", args)).data.length, 0);
  ok("end all sessions also revokes the current device");
  // The original second-device session was revoked during MFA verification.
  assert.equal((await admin.rpc("read_account_security", { p_user_id: userId, p_session_id: secondId })).data.length, 0);
  console.log(JSON.stringify({ passed: checked.length, checks: checked }));
} finally {
  if (userId) { const removed = await admin.auth.admin.deleteUser(userId); requireSuccess(removed, "Clean up verification account"); console.log("Verification account and credentials removed."); }
}
