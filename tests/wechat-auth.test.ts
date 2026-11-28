import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as protocol from "../lib/wechat-auth/protocol.ts";
import * as alipay from "../lib/alipay-auth/protocol.ts";
import { wechatProviderSettings } from "../scripts/setup-wechat-login.mjs";

const environment = {
  NODE_ENV: "production", WECHAT_LOGIN_ENABLED: "true", WECHAT_APP_ID: "wx1234567890abcdef", WECHAT_APP_SECRET: "a".repeat(32),
  WECHAT_OAUTH_CLIENT_SECRET: protocol.opaqueToken(), WECHAT_OAUTH_SUBJECT_KEY: protocol.opaqueToken(), NEXT_PUBLIC_APP_URL: "https://crm.example",
};
function load(file: string, dependencies: Record<string, unknown>, globals = {}) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, process: { env: { ...environment } }, URL, URLSearchParams, Date, Buffer, AbortSignal, ...globals });
  return exports;
}

test("WeChat state is confidential, browser bound, authenticated, expiring and isolated from Alipay", () => {
  const now = Date.now(), state = protocol.opaqueToken(), secret = protocol.opaqueToken();
  const grant = { state, upstreamState: "signed-supabase-state", challenge: protocol.digest("challenge"), expires: now + 590000 };
  const cookie = protocol.sealGrant(grant, secret);
  assert.equal(protocol.openGrant(cookie, state, secret, now).upstreamState, grant.upstreamState);
  assert.ok(!Buffer.from(cookie, "base64url").includes(Buffer.from(grant.upstreamState)));
  const changed = Buffer.from(cookie, "base64url"); changed[30] ^= 1;
  for (const invalid of [() => protocol.openGrant(changed.toString("base64url"), state, secret), () => protocol.openGrant(cookie, protocol.opaqueToken(), secret),
    () => protocol.openGrant(cookie, state, protocol.opaqueToken()), () => protocol.openGrant(cookie, state, secret, now + 600000),
    () => protocol.openGrant("", state, secret), () => protocol.openGrant(alipay.sealGrant(grant, secret), state, secret)]) assert.throws(invalid);
});

test("authorization requires the exact Supabase redirect, bridge client, S256, and unique parameters", () => {
  const callback = "https://project.supabase.co/auth/v1/callback";
  const params = { client_id: protocol.oauthClientId, redirect_uri: callback, response_type: "code", state: "upstream", code_challenge_method: "S256", code_challenge: protocol.digest("v") };
  protocol.validateAuthorization(params, callback);
  for (const changes of [{ client_id: alipay.oauthClientId }, { redirect_uri: "https://evil.example" }, { code_challenge_method: "plain" }, { state: "" }, { code_challenge: "short" }]) assert.throws(() => protocol.validateAuthorization({ ...params, ...changes }, callback));
  assert.throws(() => protocol.singleParams(new URLSearchParams("state=one&state=two")));
  assert.throws(() => protocol.singleParams(new URLSearchParams({ code: "x".repeat(8193) })));
  assert.equal(protocol.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.throws(() => protocol.pkceChallenge("short"));
});

test("WeChat subjects are stable, pseudonymous and scoped to the approved website AppID", () => {
  const openId = "openid_verified_by_wechat", key = protocol.opaqueToken();
  const subject = protocol.subjectFor(environment.WECHAT_APP_ID, openId, key);
  assert.equal(subject.length, 43); assert.ok(!subject.includes(openId));
  assert.equal(subject, protocol.subjectFor(environment.WECHAT_APP_ID, openId, key));
  assert.notEqual(subject, protocol.subjectFor("wx0000000000000000", openId, key));
  assert.notEqual(subject, protocol.subjectFor(environment.WECHAT_APP_ID, openId, protocol.opaqueToken()));
  for (const invalid of [undefined, "", "<script>", {}, 123]) assert.throws(() => protocol.subjectFor(environment.WECHAT_APP_ID, invalid, key));
});

test("activation fails closed for disabled or incomplete WeChat credentials", () => {
  for (const changes of [{ WECHAT_LOGIN_ENABLED: "false" }, { WECHAT_APP_ID: "mini-program" }, { WECHAT_APP_SECRET: "" }, { WECHAT_OAUTH_CLIENT_SECRET: "short" }, { WECHAT_OAUTH_SUBJECT_KEY: "" }]) {
    const api = load("lib/wechat-auth/config.ts", {}, { process: { env: { ...environment, ...changes } } });
    assert.equal(api.wechatLoginEnabled(), false);
  }
  assert.equal(load("lib/wechat-auth/config.ts", {}).wechatLoginEnabled(), true);
});

test("provider discovery enables WeChat only with server activation and fails closed on settings outages", async () => {
  let enabled = true, outage = false;
  const api = load("lib/auth-providers.ts", {
    "./env": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", supabasePublishableKey: "public-key" }, hasSupabaseAuthConfig: () => true },
    "./wechat-auth/config.ts": { wechatLoginEnabled: () => enabled },
  }, { fetch: async () => {
    if (outage) throw new Error("offline");
    return Response.json({ external: { google: true, apple: false, wechat: true } });
  }, AbortSignal });
  assert.deepEqual(Array.from(await api.getAuthProviders() as string[]), ["google", "wechat"]);
  enabled = false;
  assert.deepEqual(Array.from(await api.getAuthProviders() as string[]), ["google"]);
  enabled = true; outage = true;
  assert.deepEqual(Array.from(await api.getAuthProviders() as string[]), []);
});

function server(fetch: typeof globalThis.fetch, enabled = true, changes = {}) {
  return load("lib/wechat-auth/server.ts", { "server-only": {}, "../env.ts": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example/path", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" } },
    "./config.ts": { wechatLoginEnabled: () => enabled }, "./protocol.ts": protocol }, { fetch, process: { env: { ...environment, ...changes } } });
}

test("the WeChat server exchanges codes only at the official HTTPS endpoint and ignores profile identity claims", async () => {
  let calls = 0;
  const api = server(async (input, options) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://api.weixin.qq.com/sns/oauth2/access_token");
    assert.equal(url.searchParams.get("appid"), environment.WECHAT_APP_ID);
    assert.equal(url.searchParams.get("secret"), environment.WECHAT_APP_SECRET);
    assert.equal(url.searchParams.get("grant_type"), "authorization_code");
    assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    return Response.json({ access_token: "private-wechat-token", refresh_token: "private-refresh", expires_in: 7200, scope: "snsapi_login", openid: "verified-openid", unionid: "ignored", nickname: "Ignored", email: "attacker@example.test" });
  });
  assert.equal(await api.verifiedWechatSubject("authorized-code-123"), protocol.subjectFor(environment.WECHAT_APP_ID, "verified-openid", environment.WECHAT_OAUTH_SUBJECT_KEY));
  await assert.rejects(api.verifiedWechatSubject("short") as Promise<unknown>);
  assert.equal(calls, 1);
  await assert.rejects(server(async () => { assert.fail("disabled exchange"); }, false).verifiedWechatSubject("authorized-code-123") as Promise<unknown>);
});

test("WeChat HTTP errors, API errors, malformed JSON, missing identity, and wrong scopes never establish identity", async () => {
  const good = { access_token: "private", expires_in: 7200, scope: "snsapi_login", openid: "verified-openid" };
  for (const value of [{ errcode: 40029 }, { ...good, errcode: 40163 }, { ...good, openid: "" }, { ...good, access_token: "" }, { ...good, expires_in: 0 }, { ...good, scope: "snsapi_userinfo" }, null]) {
    await assert.rejects(server(async () => Response.json(value)).verifiedWechatSubject("authorized-code-123") as Promise<unknown>);
  }
  await assert.rejects(server(async () => new Response("bad json")).verifiedWechatSubject("authorized-code-123") as Promise<unknown>);
  await assert.rejects(server(async () => new Response("outage", { status: 503 })).verifiedWechatSubject("authorized-code-123") as Promise<unknown>);
  await assert.rejects(server(async () => { throw new Error("timeout"); }).verifiedWechatSubject("authorized-code-123") as Promise<unknown>);
});

test("provider setup enables only approved configurations, requires HTTPS and preserves PKCE/email completion", () => {
  const settings = wechatProviderSettings(environment);
  assert.equal(settings.enabled, true); assert.equal(settings.pkce_enabled, true); assert.equal(settings.email_optional, true);
  assert.equal(settings.authorization_url, "https://crm.example/auth/wechat/authorize");
  assert.equal(settings.token_url, "https://crm.example/auth/wechat/token");
  assert.equal(settings.userinfo_url, "https://crm.example/auth/wechat/userinfo");
  assert.equal(settings.client_id, protocol.oauthClientId);
  assert.equal(wechatProviderSettings({ ...environment, WECHAT_LOGIN_ENABLED: "false", WECHAT_APP_SECRET: "" }).enabled, false);
  for (const changes of [{ NEXT_PUBLIC_APP_URL: "http://crm.example" }, { WECHAT_APP_SECRET: "" }, { WECHAT_OAUTH_CLIENT_SECRET: "" }]) assert.throws(() => wechatProviderSettings({ ...environment, ...changes }));
});
