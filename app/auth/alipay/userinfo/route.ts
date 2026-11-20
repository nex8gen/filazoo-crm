import { NextResponse } from "next/server";
import { digest } from "@/lib/alipay-auth/protocol";
import { loginConfig, oauthHeaders } from "@/lib/alipay-auth/server";
import { createSupabaseControl } from "@/lib/supabase/control";

export async function GET(request: Request) {
  try {
    loginConfig();
    const authorization = request.headers.get("authorization") || "";
    if (!/^Bearer [A-Za-z0-9_-]{43}$/i.test(authorization)) throw new Error("Invalid token.");
    const { data, error } = await createSupabaseControl().from("alipay_login_grants").select("subject")
      .eq("access_hash", digest(authorization.slice(7))).gt("access_expires_at", new Date().toISOString()).not("redeemed_at", "is", null).maybeSingle();
    if (error || !data) throw new Error("Expired token.");
    return NextResponse.json({ sub: data.subject, name: "Alipay member", email_verified: false }, { headers: oauthHeaders });
  } catch { return NextResponse.json({ error: "invalid_token" }, { status: 401, headers: { ...oauthHeaders, "WWW-Authenticate": "Bearer" } }); }
}
