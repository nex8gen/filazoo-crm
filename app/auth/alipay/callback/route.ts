import { NextResponse, type NextRequest } from "next/server";
import { digest, opaqueToken, openGrant, singleParams } from "@/lib/alipay-auth/protocol";
import { bridgeCookie, bridgeCookieOptions, loginConfig, oauthHeaders, verifiedAlipaySubject } from "@/lib/alipay-auth/server";
import { createSupabaseControl } from "@/lib/supabase/control";

export async function GET(request: NextRequest) {
  let response: NextResponse;
  try {
    const config = loginConfig();
    const params = singleParams(request.nextUrl.searchParams);
    const grant = openGrant(request.cookies.get(bridgeCookie)?.value || "", params.state || "", config.secret);
    if (params.app_id !== config.appId || params.error || !params.auth_code) throw new Error("Authorization declined.");
    const subject = await verifiedAlipaySubject(params.auth_code);
    const code = opaqueToken();
    const control = createSupabaseControl();
    // Expired grants are unusable; bounded retention needs no Alipay token storage.
    await control.from("alipay_login_grants").delete().lt("created_at", new Date(Date.now() - 86400_000).toISOString());
    const { error } = await control.from("alipay_login_grants").insert({ code_hash: digest(code), challenge: grant.challenge, subject });
    if (error) throw new Error("Unable to issue sign-in grant.");
    const url = new URL(config.supabaseCallback);
    url.search = new URLSearchParams({ code, state: grant.upstreamState }).toString();
    response = NextResponse.redirect(url, { headers: oauthHeaders });
  } catch {
    response = NextResponse.redirect(new URL("/auth/alipay/error", request.url), { headers: oauthHeaders });
  }
  response.cookies.set(bridgeCookie, "", { ...bridgeCookieOptions, maxAge: 0 });
  return response;
}
