import { NextResponse, type NextRequest } from "next/server";
import { loginDestination } from "@/lib/login-destination";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = loginDestination(request.nextUrl.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (!data.user.email || !data.user.email_confirmed_at) return NextResponse.redirect(new URL(`/auth/email?next=${encodeURIComponent(next)}`, request.url));
      if (data.user.factors?.some(factor => factor.status === "verified")) return NextResponse.redirect(new URL(`/auth/mfa?next=${encodeURIComponent(next)}`, request.url));
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/auth/error?reason=invalid-link", request.url));
}
