import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Customer access is validated by its own invoice-scoped cookie and QR key.
  // Never run the staff session gate (or refresh staff cookies) for this surface.
  const customerRoute = request.nextUrl.pathname.startsWith("/customer/") || request.nextUrl.pathname.startsWith("/api/customer/");
  if (customerRoute) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headersToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (headersToSet) Object.entries(headersToSet).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  // Meta reaches this webhook without a Filazoo session. POST requests are
  // authenticated separately with Meta's x-hub-signature-256 HMAC signature.
  const publicPaths = [
    "/lead-channel/ai-agent/qa",
    "/login",
    "/forgot-password",
    "/accept-invitation",
    "/update-password",
    "/privacy",
    "/data-deletion",
    "/api/health",
    // These handlers validate their own signed token / cron bearer secret.
    "/api/flows/track",
    "/api/cron/flows",
    "/api/meta/webhook",
    "/api/twilio/webhook",
    // Make authenticates this receiver with its own bearer secret.
    "/api/meta/lead-bridge",
    "/api/shopify/webhook",
    "/api/shopify/form-lead",
  ];
  const isPublic = publicPaths.includes(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/auth/");
  if (process.env.AUTH_REQUIRED === "true" && !data?.claims && !isPublic) {
    const invoiceQr = /^\/invoices\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(request.nextUrl.pathname);
    if (invoiceQr) {
      const customerUrl = request.nextUrl.clone();
      customerUrl.pathname = `/customer/legacy/${invoiceQr[1]}`;
      customerUrl.search = "";
      return NextResponse.redirect(customerUrl, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
