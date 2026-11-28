import { NextResponse } from "next/server";
import { digest, oauthClientId, opaqueToken, pkceChallenge, sameSecret, singleParams } from "@/lib/wechat-auth/protocol";
import { loginConfig, oauthHeaders } from "@/lib/wechat-auth/server";
import { createSupabaseControl } from "@/lib/supabase/control";

export async function POST(request: Request) {
  try {
    const config = loginConfig();
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new Error("Invalid content type.");
    const body = await request.text();
    if (body.length > 8192) throw new Error("Oversized request.");
    const params = singleParams(new URLSearchParams(body));
    let client = params.client_id || "", secret = params.client_secret || "";
    const authorization = request.headers.get("authorization");
    if (authorization) {
      if (client || secret || !authorization.startsWith("Basic ")) throw new Error("Invalid client authentication.");
      const credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const separator = credentials.indexOf(":");
      if (separator < 0) throw new Error("Invalid client authentication.");
      client = decodeURIComponent(credentials.slice(0, separator)); secret = decodeURIComponent(credentials.slice(separator + 1));
    }
    if (client !== oauthClientId || !secret || !sameSecret(secret, config.secret)) return NextResponse.json({ error: "invalid_client" }, { status: 401, headers: oauthHeaders });
    if (params.grant_type !== "authorization_code" || params.redirect_uri !== config.supabaseCallback || !/^[A-Za-z0-9_-]{43}$/.test(params.code || "")) throw new Error("Invalid grant.");
    const access = opaqueToken();
    const { data, error } = await createSupabaseControl().rpc("redeem_wechat_login_code", {
      p_code_hash: digest(params.code), p_challenge: pkceChallenge(params.code_verifier || ""), p_access_hash: digest(access),
    });
    if (error || !data?.length) throw new Error("Invalid or expired grant.");
    return NextResponse.json({ access_token: access, token_type: "Bearer", expires_in: 300 }, { headers: oauthHeaders });
  } catch { return NextResponse.json({ error: "invalid_grant" }, { status: 400, headers: oauthHeaders }); }
}
