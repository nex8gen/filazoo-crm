import { NextResponse, type NextRequest } from "next/server";
import { digest, opaqueToken, openGrant, singleParams } from "@/lib/wechat-auth/protocol";
import { bridgeCookie, bridgeCookieOptions, loginConfig, oauthHeaders, verifiedWechatSubject } from "@/lib/wechat-auth/server";
import { createSupabaseControl } from "@/lib/supabase/control";

export async function GET(request: NextRequest) {
  let response: NextResponse;
  try {
    const config = loginConfig();
    const params = singleParams(request.nextUrl.searchParams);
    const grant = openGrant(request.cookies.get(bridgeCookie)?.value || "", params.state || "", config.secret);
    if (params.error || !params.code) throw new Error("Authorization declined.");
    const subject = await verifiedWechatSubject(params.code);
    const code = opaqueToken();
    const control = createSupabaseControl();
    await control.from("wechat_login_grants").delete().lt("created_at", new Date(Date.now() - 86400_000).toISOString());
    const { error } = await control.from("wechat_login_grants").insert({ code_hash: digest(code), challenge: grant.challenge, subject });
    if (error) throw new Error("Unable to issue sign-in grant.");
    const url = new URL(config.supabaseCallback);
    url.search = new URLSearchParams({ code, state: grant.upstreamState }).toString();
    response = NextResponse.redirect(url, { headers: oauthHeaders });
  } catch {
    response = NextResponse.redirect(new URL("/auth/wechat/error", request.url), { headers: oauthHeaders });
  }
  response.cookies.set(bridgeCookie, "", { ...bridgeCookieOptions, maxAge: 0 });
  return response;
}
