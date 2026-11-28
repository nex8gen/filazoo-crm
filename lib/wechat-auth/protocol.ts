import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const oauthClientId = "filazoo-wechat";
export const opaqueToken = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
export function sameSecret(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}
export function singleParams(params: URLSearchParams) {
  const result: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key) || value.length > 8192) throw new Error("Invalid OAuth parameters.");
    result[key] = value;
  }
  return result;
}
export type BrowserGrant = { state: string; upstreamState: string; challenge: string; expires: number };
const context = Buffer.from("filazoo-wechat-oauth-v1");
export function sealGrant(grant: BrowserGrant, secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), nonce);
  cipher.setAAD(context);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(grant), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function openGrant(cookie: string, state: string, secret: string, now = Date.now()): BrowserGrant {
  if (!cookie || cookie.length > 3800 || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error("Invalid state.");
  const bytes = Buffer.from(cookie, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), bytes.subarray(0, 12));
  decipher.setAAD(context);
  decipher.setAuthTag(bytes.subarray(12, 28));
  const grant = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as BrowserGrant;
  if (typeof grant.state !== "string" || !sameSecret(grant.state, state)
    || !Number.isFinite(grant.expires) || grant.expires <= now || grant.expires > now + 600_000
    || typeof grant.upstreamState !== "string" || !grant.upstreamState || grant.upstreamState.length > 1800
    || !/^[A-Za-z0-9_-]{43}$/.test(grant.challenge)) throw new Error("Expired or invalid state.");
  return grant;
}
export function validateAuthorization(params: Record<string, string>, redirectUri: string) {
  if (params.client_id !== oauthClientId || params.redirect_uri !== redirectUri || params.response_type !== "code"
    || params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || "")
    || !params.state || params.state.length > 1800) throw new Error("Invalid authorization request.");
}
export function pkceChallenge(verifier: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error("Invalid PKCE verifier.");
  return digest(verifier);
}
export function subjectFor(appId: string, openId: unknown, subjectKey: string) {
  if (typeof openId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(openId)) throw new Error("WeChat did not verify an identity.");
  // Keep the app-scoped subject stable. Do not switch to UnionID when it later
  // becomes available, or merge accounts using a nickname or callback OpenID.
  return createHmac("sha256", subjectKey).update(`${appId}:open:${openId}`).digest("base64url");
}
