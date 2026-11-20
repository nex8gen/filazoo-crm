import "server-only";
import { readFileSync } from "node:fs";
import { AlipaySdk } from "alipay-sdk";
import { env } from "../env.ts";
import { subjectFor } from "./protocol.ts";

export function alipayLoginEnabled() { return process.env.ALIPAY_LOGIN_ENABLED === "true"; }
export function loginConfig() {
  const secret = process.env.ALIPAY_OAUTH_CLIENT_SECRET || "";
  const subjectKey = process.env.ALIPAY_OAUTH_SUBJECT_KEY || "";
  const appId = process.env.ALIPAY_APP_ID || "";
  if (!alipayLoginEnabled() || secret.length < 43 || subjectKey.length < 43 || !/^\d{16}$/.test(appId)) throw new Error("Alipay sign-in is awaiting activation.");
  const origin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("HTTPS required.");
  return { secret, subjectKey, appId, origin, callback: `${origin}/auth/alipay/callback`, supabaseCallback: `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback` };
}
function key(name: string) {
  if (process.env[name]) return process.env[name]!.replace(/\\n/g, "\n");
  return process.env[`${name}_PATH`] ? readFileSync(process.env[`${name}_PATH`]!, "utf8") : "";
}
let sdk: AlipaySdk | undefined;
export async function verifiedAlipaySubject(code: string) {
  const config = loginConfig();
  if (!/^[A-Za-z0-9_-]{16,1024}$/.test(code)) throw new Error("Invalid authorization code.");
  if (!sdk) {
    const privateKey = key("ALIPAY_PRIVATE_KEY"), publicKey = key("ALIPAY_PUBLIC_KEY");
    // The SDK skips verification when its public key is empty. Fail closed.
    if (!privateKey.trim() || !publicKey.trim()) throw new Error("Alipay signing keys are not configured.");
    sdk = new AlipaySdk({ appId: config.appId, privateKey, alipayPublicKey: publicKey,
      keyType: "PKCS8", signType: "RSA2", gateway: "https://openapi.alipay.com/gateway.do", camelcase: false, timeout: 8000 });
  }
  const result = await sdk.exec("alipay.system.oauth.token", { grant_type: "authorization_code", code }, { validateSign: true });
  // The signed token exchange supplies the identity. No Alipay access/refresh
  // token or profile is persisted, and merchant/payment credentials are unused.
  if (!result.access_token || (result.code && result.code !== "10000")) throw new Error("Alipay rejected sign-in.");
  return subjectFor(config.appId, { open_id: result.open_id, user_id: result.user_id }, config.subjectKey);
}
export const bridgeCookie = process.env.NODE_ENV === "production" ? "__Host-filazoo-alipay" : "filazoo-alipay";
export const bridgeCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
export const oauthHeaders = { "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
