import "server-only";
import { env } from "../env.ts";
import { wechatLoginEnabled } from "./config.ts";
import { subjectFor } from "./protocol.ts";

export function loginConfig() {
  if (!wechatLoginEnabled() || !env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("WeChat sign-in is awaiting activation.");
  const origin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("HTTPS required.");
  return {
    secret: process.env.WECHAT_OAUTH_CLIENT_SECRET!, subjectKey: process.env.WECHAT_OAUTH_SUBJECT_KEY!,
    appId: process.env.WECHAT_APP_ID!, appSecret: process.env.WECHAT_APP_SECRET!, origin,
    callback: `${origin}/auth/wechat/callback`, supabaseCallback: `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`,
  };
}

export async function verifiedWechatSubject(code: string) {
  const config = loginConfig();
  if (!/^[A-Za-z0-9_-]{16,1024}$/.test(code)) throw new Error("Invalid authorization code.");
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret, code, grant_type: "authorization_code" }).toString();
  // WeChat requires a server-side GET exchange. Never log this URL or persist
  // its access/refresh tokens; they are not application sessions.
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("WeChat sign-in is temporarily unavailable.");
  const token = await response.json();
  if (!token || (token.errcode !== undefined && token.errcode !== 0)
    || typeof token.access_token !== "string" || !token.access_token
    || !Number.isFinite(token.expires_in) || token.expires_in <= 0
    || typeof token.scope !== "string" || !token.scope.split(",").includes("snsapi_login")) throw new Error("WeChat rejected sign-in.");
  return subjectFor(config.appId, token.openid, config.subjectKey);
}

export const bridgeCookie = process.env.NODE_ENV === "production" ? "__Host-filazoo-wechat" : "filazoo-wechat";
export const bridgeCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
export const oauthHeaders = { "Cache-Control": "no-store", "Pragma": "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
