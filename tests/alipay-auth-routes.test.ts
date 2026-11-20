import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as protocol from "../lib/alipay-auth/protocol.ts";

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Request, Response, Buffer, URL, URLSearchParams, Date });
  return exports;
}
class Result extends Response {
  cookieValues: unknown[][] = [];
  cookies = { set: (...args: unknown[]) => this.cookieValues.push(args) };
  static json(value: unknown, init?: ResponseInit) { return new Result(JSON.stringify(value), init); }
  static redirect(url: URL, init?: ResponseInit) { return new Result(null, { ...init, status: 307, headers: { ...init?.headers, location: url.toString() } }); }
}
const config = { secret: protocol.opaqueToken(), subjectKey: protocol.opaqueToken(), appId: "2021007121675450", callback: "https://crm.example/auth/alipay/callback", supabaseCallback: "https://project.supabase.co/auth/v1/callback" };
const server = { loginConfig: () => config, oauthHeaders: { "Cache-Control": "no-store" }, bridgeCookie: "binding", bridgeCookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } };
const deps = { "next/server": { NextResponse: Result }, "@/lib/alipay-auth/protocol": protocol, "@/lib/alipay-auth/server": server };

test("authorize uses official Alipay consent and binds the Supabase PKCE state to a private browser cookie", async () => {
  const api = load("app/auth/alipay/authorize/route.ts", deps);
  const params = new URLSearchParams({ client_id: protocol.oauthClientId, redirect_uri: config.supabaseCallback, response_type: "code", state: "supabase-state", code_challenge_method: "S256", code_challenge: protocol.digest("verifier") });
  const response = await api.GET({ nextUrl: new URL(`https://crm.example/auth/alipay/authorize?${params}`) }) as Result;
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin, "https://openauth.alipay.com");
  assert.equal(location.pathname, "/oauth2/publicAppAuthorize.htm");
  assert.equal(location.searchParams.get("scope"), "auth_user");
  assert.equal(location.searchParams.get("redirect_uri"), config.callback);
  const grant = protocol.openGrant(response.cookieValues[0][1] as string, location.searchParams.get("state")!, config.secret);
  assert.equal(grant.upstreamState, "supabase-state");
  params.set("redirect_uri", "https://attacker.example");
  assert.equal((await api.GET({ nextUrl: new URL(`https://crm.example/?${params}`) })).status, 400);
});
test("callback rejects forged state/app IDs before exchanging codes or writing identity grants", async () => {
  let exchanges = 0, inserts = 0;
  const state = protocol.opaqueToken(), code = protocol.opaqueToken();
  const cookie = protocol.sealGrant({ state, upstreamState: "signed-upstream", challenge: protocol.digest("v"), expires: Date.now() + 599_000 }, config.secret);
  const api = load("app/auth/alipay/callback/route.ts", { ...deps,
    "@/lib/alipay-auth/server": { ...server, verifiedAlipaySubject: async (value: string) => { exchanges++; assert.equal(value, code); return protocol.digest("verified-subject"); } },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ from: () => ({ delete: () => ({ lt: async () => ({ error: null }) }), insert: async (row: Record<string, string>) => { inserts++; assert.equal(row.subject, protocol.digest("verified-subject")); assert.notEqual(row.code_hash, code); return { error: null }; } }) }) },
  });
  const request = (stateValue: string, appId = config.appId) => ({ url: "https://crm.example/auth/alipay/callback", nextUrl: new URL(`https://crm.example/auth/alipay/callback?${new URLSearchParams({ state: stateValue, app_id: appId, auth_code: code, user_id: "attacker" })}`), cookies: { get: () => ({ value: cookie }) } });
  for (const invalid of [request(protocol.opaqueToken()), request(state, "wrong-app")]) {
    const result = await api.GET(invalid);
    assert.match(result.headers.get("location")!, /\/auth\/alipay\/error$/);
  }
  assert.equal(exchanges, 0); assert.equal(inserts, 0);
  const result = await api.GET(request(state)) as Result;
  const location = new URL(result.headers.get("location")!);
  assert.equal(location.origin + location.pathname, config.supabaseCallback);
  assert.equal(location.searchParams.get("state"), "signed-upstream");
  assert.equal(exchanges, 1); assert.equal(inserts, 1);
  assert.equal((result.cookieValues[0][2] as { maxAge: number }).maxAge, 0);
});
test("token endpoint requires client authentication, exact redirect, S256 and atomic single-use redemption", async () => {
  const verifier = protocol.opaqueToken(), code = protocol.opaqueToken();
  let redeemed = false, calls = 0;
  const api = load("app/auth/alipay/token/route.ts", { ...deps,
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, string>) => {
      calls++; assert.equal(name, "redeem_alipay_login_code"); assert.equal(args.p_code_hash, protocol.digest(code));
      if (redeemed || args.p_challenge !== protocol.digest(verifier)) return { data: [], error: null };
      redeemed = true; return { data: [{ subject: "verified" }], error: null };
    } }) },
  });
  const form = { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: config.supabaseCallback };
  const request = (changes = {}, auth = config.secret) => new Request("https://crm.example/auth/alipay/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${protocol.oauthClientId}:${auth}`).toString("base64")}` }, body: new URLSearchParams({ ...form, ...changes }) });
  assert.equal((await api.POST(request({}, "wrong"))).status, 401);
  assert.equal((await api.POST(request({ redirect_uri: "https://attacker.example" }))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await api.POST(request({ code_verifier: protocol.opaqueToken() }))).status, 400);
  const success = await api.POST(request());
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("cache-control"), "no-store");
  const token = await success.json();
  assert.equal(token.token_type, "Bearer"); assert.equal(token.expires_in, 300); assert.equal(token.access_token.length, 43);
  assert.equal((await api.POST(request())).status, 400);
});
