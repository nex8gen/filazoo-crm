import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authFetch } from "./auth-fetch.ts";
import { isTransientAuthError } from "./auth-error.ts";
import { workspaceSessionUnavailableResponse } from "../workspace-session-response.ts";

export async function updateSession(request: NextRequest) {
  const publicWebsiteRoute = request.nextUrl.pathname === "/website" || request.nextUrl.pathname.startsWith("/website/");
  function nextResponse() {
    const headers = new Headers(request.headers);
    headers.delete("x-filazoo-public-website");
    if (publicWebsiteRoute) headers.set("x-filazoo-public-website", "1");
    return NextResponse.next({ request: { headers } });
  }
  let response = nextResponse();
  // Alipay authenticates this callback with RSA2, without a browser session.
  if (request.nextUrl.pathname === "/api/alipay/notify") {
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  // Customer access is validated by its own invoice-scoped cookie and QR key.
  // Never run the staff session gate (or refresh staff cookies) for this surface.
  const customerRoute = request.nextUrl.pathname.startsWith("/customer/") || request.nextUrl.pathname.startsWith("/api/customer/");
  if (customerRoute || publicWebsiteRoute) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    global: { fetch: authFetch(), headers: request.headers.get("user-agent") ? { "User-Agent": request.headers.get("user-agent")!.slice(0, 1024) } : {} },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headersToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        if (headersToSet) Object.entries(headersToSet).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  // Meta reaches this webhook without a Filazoo session. POST requests are
  // authenticated separately with Meta's x-hub-signature-256 HMAC signature.
  const publicPaths = [
    "/workflow/qa",
    "/login",
    "/signup",
    "/signup/verify",
    "/forgot-password",
    "/accept-invitation",
    "/update-password",
    "/privacy",
    "/terms",
    "/data-deletion",
    "/api/health",
    // These handlers validate their own signed token / cron bearer secret.
    "/api/flows/track",
    "/api/cron/flows",
    "/api/cron/mail-sync",
    "/api/cron/customer-replies",
    "/api/cron/inventory",
    "/api/meta/webhook",
    "/api/twilio/webhook",
    // Make authenticates this receiver with its own bearer secret.
    "/api/meta/lead-bridge",
    "/api/shopify/webhook",
    "/api/shopify/form-lead",
  ];
  const isPublic = publicPaths.includes(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/auth/") || request.nextUrl.pathname.startsWith("/join/");
  if (!isPublic && isTransientAuthError(error)) {
    if (request.nextUrl.pathname.startsWith("/api/")) return workspaceSessionUnavailableResponse();
    // Let the page's authenticated loader retry independently, then show its
    // recoverable error boundary if the outage persists. Never redirect to
    // login, clear cookies, or authorize from an unverified token here.
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (!data?.claims && !isPublic) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in with an active workspace account." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    }
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
  response.headers?.set("Cache-Control", "private, no-store");
  if (request.nextUrl.pathname.startsWith("/join/")) response.headers?.set("Referrer-Policy", "no-referrer");
  return response;
}
