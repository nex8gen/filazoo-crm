import { NextResponse, type NextRequest } from "next/server";
import { opaqueToken, sealGrant, singleParams, validateAuthorization } from "@/lib/wechat-auth/protocol";
import { bridgeCookie, bridgeCookieOptions, loginConfig, oauthHeaders } from "@/lib/wechat-auth/server";

export async function GET(request: NextRequest) {
  try {
    const config = loginConfig();
    const params = singleParams(request.nextUrl.searchParams);
    validateAuthorization(params, config.supabaseCallback);
    const state = opaqueToken();
    const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
    url.search = new URLSearchParams({ appid: config.appId, redirect_uri: config.callback, response_type: "code", scope: "snsapi_login", state }).toString();
    url.hash = "wechat_redirect";
    const response = NextResponse.redirect(url, { headers: oauthHeaders });
    response.cookies.set(bridgeCookie, sealGrant({ state, upstreamState: params.state, challenge: params.code_challenge, expires: Date.now() + 600_000 }, config.secret), bridgeCookieOptions);
    return response;
  } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: oauthHeaders }); }
}
