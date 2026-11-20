import { NextResponse, type NextRequest } from "next/server";
import { opaqueToken, sealGrant, singleParams, validateAuthorization } from "@/lib/alipay-auth/protocol";
import { bridgeCookie, bridgeCookieOptions, loginConfig, oauthHeaders } from "@/lib/alipay-auth/server";

export async function GET(request: NextRequest) {
  try {
    const config = loginConfig();
    const params = singleParams(request.nextUrl.searchParams);
    validateAuthorization(params, config.supabaseCallback);
    const state = opaqueToken();
    const url = new URL("https://openauth.alipay.com/oauth2/publicAppAuthorize.htm");
    url.search = new URLSearchParams({ app_id: config.appId, scope: "auth_user", redirect_uri: config.callback, state }).toString();
    const response = NextResponse.redirect(url, { headers: oauthHeaders });
    response.cookies.set(bridgeCookie, sealGrant({ state, upstreamState: params.state, challenge: params.code_challenge, expires: Date.now() + 600_000 }, config.secret), bridgeCookieOptions);
    return response;
  } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: oauthHeaders }); }
}
