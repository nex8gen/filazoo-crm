import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as protocol from "../lib/wechat-auth/protocol.ts";
import { signupDestination } from "../lib/signup.ts";
import { loginDestination } from "../lib/login-destination.ts";

function load(file: string, dependencies: Record<string, unknown>, globals = {}) {
  const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Request, Response, Buffer, URL, URLSearchParams, Date, ...globals });
  return exports;
}
class Result extends Response {
  cookieValues: unknown[][] = [];
  cookies = { set: (...args: unknown[]) => this.cookieValues.push(args) };
  static json(value: unknown, init?: ResponseInit) { return new Result(JSON.stringify(value), init); }
  static redirect(url: URL, init?: ResponseInit) { return new Result(null, { ...init, status: 307, headers: { ...init?.headers, location: url.toString() } }); }
}
const config = { secret: protocol.opaqueToken(), subjectKey: protocol.opaqueToken(), appId: "wx1234567890abcdef", callback: "https://crm.example/auth/wechat/callback", supabaseCallback: "https://project.supabase.co/auth/v1/callback" };
const server = { loginConfig: () => config, oauthHeaders: { "Cache-Control": "no-store" }, bridgeCookie: "wechat-binding", bridgeCookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } };
const deps = { "next/server": { NextResponse: Result }, "@/lib/wechat-auth/protocol": protocol, "@/lib/wechat-auth/server": server };

test("WeChat authorization opens the official QR page and binds a private browser cookie to Supabase PKCE", async () => {
  const api = load("app/auth/wechat/authorize/route.ts", deps);
  const params = new URLSearchParams({ client_id: protocol.oauthClientId, redirect_uri: config.supabaseCallback, response_type: "code", state: "signed-upstream-state", code_challenge_method: "S256", code_challenge: protocol.digest("verifier") });
  const response = await api.GET({ nextUrl: new URL(`https://crm.example/auth/wechat/authorize?${params}`) }) as Result;
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin + location.pathname, "https://open.weixin.qq.com/connect/qrconnect");
  assert.equal(location.searchParams.get("appid"), config.appId);
  assert.equal(location.searchParams.get("redirect_uri"), config.callback);
  assert.equal(location.searchParams.get("scope"), "snsapi_login");
  assert.equal(location.hash, "#wechat_redirect");
  const binding = protocol.openGrant(response.cookieValues[0][1] as string, location.searchParams.get("state")!, config.secret);
  assert.equal(binding.upstreamState, "signed-upstream-state"); assert.equal(binding.challenge, protocol.digest("verifier"));
  assert.equal((response.cookieValues[0][2] as { httpOnly: boolean }).httpOnly, true);
  params.append("state", "duplicate");
  assert.equal((await api.GET({ nextUrl: new URL(`https://crm.example/?${params}`) })).status, 400);
  params.delete("state"); params.set("state", "upstream"); params.set("redirect_uri", "https://evil.example");
  assert.equal((await api.GET({ nextUrl: new URL(`https://crm.example/?${params}`) })).status, 400);
});

test("WeChat callback refuses missing, forged, expired or cancelled state before identity exchange", async () => {
  let exchanges = 0, inserts = 0;
  const state = protocol.opaqueToken(), code = "one-use-wechat-code";
  const grant = { state, upstreamState: "upstream", challenge: protocol.digest("verifier"), expires: Date.now() + 590000 };
  const api = load("app/auth/wechat/callback/route.ts", { ...deps,
    "@/lib/wechat-auth/server": { ...server, verifiedWechatSubject: async (value: string) => { exchanges++; assert.equal(value, code); return protocol.digest("verified-subject"); } },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ from: (table: string) => { assert.equal(table, "wechat_login_grants"); return {
      delete: () => ({ lt: async () => ({ error: null }) }), insert: async (row: Record<string, string>) => {
        inserts++; assert.equal(row.subject, protocol.digest("verified-subject")); assert.notEqual(row.code_hash, code); assert.equal(row.challenge, grant.challenge);
        assert.deepEqual(Object.keys(row).sort(), ["challenge", "code_hash", "subject"]); return { error: null };
      },
    }; } }) },
  });
  const cookie = protocol.sealGrant(grant, config.secret);
  const request = (params: Record<string, string>, value = cookie) => ({ url: config.callback, nextUrl: new URL(`${config.callback}?${new URLSearchParams(params)}`), cookies: { get: () => ({ value }) } });
  for (const invalid of [request({ code, state: protocol.opaqueToken() }), request({ code, state }, ""), request({ state }), request({ code, state, error: "access_denied" }),
    request({ code, state }, protocol.sealGrant({ ...grant, expires: Date.now() - 1 }, config.secret))]) {
    const response = await api.GET(invalid) as Result;
    assert.equal(response.headers.get("location"), "https://crm.example/auth/wechat/error");
    assert.equal((response.cookieValues[0][2] as { maxAge: number }).maxAge, 0);
  }
  assert.equal(exchanges, 0); assert.equal(inserts, 0);
  const response = await api.GET(request({ code, state, openid: "attacker", unionid: "attacker" })) as Result;
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin + location.pathname, config.supabaseCallback);
  assert.equal(location.searchParams.get("state"), "upstream");
  assert.equal(location.searchParams.get("code")?.length, 43);
  assert.equal(exchanges, 1); assert.equal(inserts, 1);
});

test("token endpoint requires the bridge client, exact redirect, S256 and single-use atomic redemption", async () => {
  const verifier = protocol.opaqueToken(), code = protocol.opaqueToken();
  let redeemed = false, calls = 0;
  const api = load("app/auth/wechat/token/route.ts", { ...deps,
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, string>) => {
      calls++; assert.equal(name, "redeem_wechat_login_code"); assert.equal(args.p_code_hash, protocol.digest(code));
      assert.equal(args.p_access_hash.length, 43);
      if (redeemed || args.p_challenge !== protocol.digest(verifier)) return { data: [], error: null };
      redeemed = true; return { data: [{ subject: "verified" }], error: null };
    } }) },
  });
  const form = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.supabaseCallback };
  const request = (changes = {}, secret = config.secret, type = "application/x-www-form-urlencoded") => new Request("https://crm.example/auth/wechat/token", { method: "POST", headers: { "content-type": type, authorization: `Basic ${Buffer.from(`${protocol.oauthClientId}:${secret}`).toString("base64")}` }, body: new URLSearchParams({ ...form, ...changes }) });
  assert.equal((await api.POST(request({}, "wrong-secret"))).status, 401);
  assert.equal((await api.POST(request({ client_id: "ambiguous-auth" }))).status, 400);
  assert.equal((await api.POST(request({ redirect_uri: "https://evil.example" }))).status, 400);
  assert.equal((await api.POST(request({ grant_type: "refresh_token" }))).status, 400);
  assert.equal((await api.POST(request({}, config.secret, "application/json"))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await api.POST(request({ code_verifier: protocol.opaqueToken() }))).status, 400);
  const response = await api.POST(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const token = await response.json();
  assert.equal(token.token_type, "Bearer"); assert.equal(token.expires_in, 300); assert.equal(token.access_token.length, 43);
  assert.equal((await api.POST(request())).status, 400);
});

test("userinfo requires a live redeemed bridge token and exposes only the pseudonymous identity", async () => {
  const access = protocol.opaqueToken(); let calls = 0, valid = true;
  const chain = {
    select: (field: string) => { calls++; assert.equal(field, "subject"); return chain; },
    eq: (field: string, value: string) => { assert.equal(field, "access_hash"); assert.equal(value, protocol.digest(access)); return chain; },
    gt: (field: string, value: string) => { assert.equal(field, "access_expires_at"); assert.ok(Date.parse(value) > Date.now() - 5000); return chain; },
    not: (field: string, operator: string, value: unknown) => { assert.equal(field, "redeemed_at"); assert.equal(operator, "is"); assert.equal(value, null); return chain; },
    maybeSingle: async () => ({ data: valid ? { subject: "pseudonymous-subject" } : null, error: null }),
  };
  const api = load("app/auth/wechat/userinfo/route.ts", { ...deps, "@/lib/supabase/control": { createSupabaseControl: () => ({ from: (table: string) => { assert.equal(table, "wechat_login_grants"); return chain; } }) } });
  for (const auth of ["", "Bearer short", `Basic ${access}`]) assert.equal((await api.GET(new Request("https://crm.example", { headers: { authorization: auth } }))).status, 401);
  assert.equal(calls, 0);
  const request = () => new Request("https://crm.example", { headers: { authorization: `Bearer ${access}` } });
  assert.deepEqual(await (await api.GET(request())).json(), { sub: "pseudonymous-subject", name: "WeChat member", email_verified: false });
  valid = false;
  const expired = await api.GET(request());
  assert.equal(expired.status, 401); assert.equal(expired.headers.get("www-authenticate"), "Bearer");
});

test("social sign-in uses custom:wechat, preserves invitations and rejects unavailable or forged providers", async () => {
  let available = true, calls = 0;
  const api = load("app/auth/social-actions.ts", {
    "next/navigation": { redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
    "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } }, "@/lib/signup": { signupDestination },
    "@/lib/auth-providers": { getAuthProviders: async () => available ? ["wechat"] : [] },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { signInWithOAuth: async (params: { provider: string; options: { redirectTo: string } }) => {
      calls++; assert.equal(params.provider, "custom:wechat");
      const callback = new URL(params.options.redirectTo);
      assert.equal(callback.origin + callback.pathname, "https://crm.example/auth/callback");
      assert.equal(callback.searchParams.get("next"), "/join/invite-id");
      return { data: { url: "https://project.supabase.co/auth/v1/authorize?provider=custom:wechat" }, error: null };
    } } }) },
  });
  const form = (provider: string) => new Map([["provider", provider], ["next", "/join/invite-id"]]);
  await api.socialSignIn(undefined, form("forged")); assert.equal(calls, 0);
  available = false; const disabled = await api.socialSignIn(undefined, form("wechat")); assert.ok("error" in disabled); assert.equal(calls, 0);
  available = true; await assert.rejects(api.socialSignIn(undefined, form("wechat")), /redirect:https:\/\/project.supabase.co/); assert.equal(calls, 1);
});

test("connecting WeChat requires a signed-in account and uses identity linking rather than creating another account", async () => {
  let signedIn = true, available = true, calls = 0;
  const api = load("app/auth/wechat/link-actions.ts", {
    "next/navigation": { redirect: (url: string) => { throw new Error(`redirect:${url}`); } },
    "@/lib/auth": { requireViewer: async () => { if (!signedIn) throw new Error("login required"); return { id: "current-user" }; } },
    "@/lib/auth-providers": { getAuthProviders: async () => available ? ["wechat"] : [] },
    "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example" } },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { linkIdentity: async (params: { provider: string; options: { redirectTo: string } }) => {
      calls++; assert.equal(params.provider, "custom:wechat"); assert.equal(new URL(params.options.redirectTo).searchParams.get("next"), "/settings/security");
      return { data: { url: "https://project.supabase.co/link" }, error: null };
    } } }) },
  });
  signedIn = false; await assert.rejects(api.connectWechat(undefined), /login required/); assert.equal(calls, 0);
  signedIn = true; available = false; assert.ok("error" in await api.connectWechat(undefined)); assert.equal(calls, 0);
  available = true; await assert.rejects(api.connectWechat(undefined), /redirect:https:\/\/project.supabase.co\/link/); assert.equal(calls, 1);
});

test("the shared OAuth callback keeps email verification, MFA and safe destinations for WeChat sessions", async () => {
  for (const scenario of ["new", "existing", "mfa", "invalid"] as const) {
    const user = { id: "user", email: scenario === "new" ? null : "verified@example.test", email_confirmed_at: scenario === "new" ? null : "2026-01-01", factors: scenario === "mfa" ? [{ status: "verified" }] : [] };
    const api = load("app/auth/callback/route.ts", { "next/server": { NextResponse: Result }, "@/lib/login-destination": { loginDestination },
      "@/lib/supabase/server": { createClient: async () => ({ auth: { exchangeCodeForSession: async (code: string) => { assert.equal(code, "supabase-code"); return { data: { user }, error: scenario === "invalid" ? {} : null }; } } }) },
    });
    const response = await api.GET({ url: "https://crm.example/auth/callback", nextUrl: new URL("https://crm.example/auth/callback?code=supabase-code&next=%2Fjoin%2Finvite-id") });
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, scenario === "new" ? "/auth/email" : scenario === "mfa" ? "/auth/mfa" : scenario === "invalid" ? "/auth/error" : "/join/invite-id");
    if (scenario === "new" || scenario === "mfa") assert.equal(location.searchParams.get("next"), "/join/invite-id");
  }
});
