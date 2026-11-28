import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { NextResponse } from "next/server";
import { isPlatformHost, portalRequestHost } from "@/lib/portal-domains";
import { findPortalDomain } from "@/lib/data/portal-domain-routing";
import { isMarketingHost, MARKETING_APP_ORIGIN, MARKETING_ORIGIN } from "@/lib/marketing";

export async function proxy(request: NextRequest) {
  const hostname = portalRequestHost(request.headers.get("host") || request.nextUrl.host);
  const demoAsset = /^\/marketing\/crm-demo\/(?:home|email|workflow|orders)\.html$/.test(request.nextUrl.pathname)
    || /^\/marketing\/crm-demo\/assets\/[a-zA-Z0-9_.-]+\.(?:css|woff2?|ttf|otf|png|svg)$/.test(request.nextUrl.pathname);
  if ((isMarketingHost(hostname) || isPlatformHost(hostname)) && demoAsset) {
    return NextResponse.next({ headers: { "Content-Security-Policy": "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-same-origin", "X-Robots-Tag": "noindex, nofollow" } });
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname) && process.env.NODE_ENV === "development" && request.nextUrl.pathname === "/marketing/demo-source") {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-newai-marketing", "1");
    return NextResponse.next({ request: { headers: requestHeaders }, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  }
  // The public brand site never reads staff sessions or customer records.
  if (isMarketingHost(hostname)) {
    if (hostname === "newai.xin") return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, MARKETING_ORIGIN), 308);
    if (request.nextUrl.pathname === "/robots.txt") return new NextResponse(`User-agent: *\nAllow: /$\nDisallow: /marketing\nSitemap: ${MARKETING_ORIGIN}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (request.nextUrl.pathname === "/sitemap.xml") return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${MARKETING_ORIGIN}/</loc></url></urlset>`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
    if (request.nextUrl.pathname === "/marketing" || request.nextUrl.pathname === "/marketing/") return NextResponse.redirect(new URL("/" + request.nextUrl.search, MARKETING_ORIGIN), 308);
    if (request.nextUrl.pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/marketing";
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-newai-marketing", "1");
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    }
    if (["/login", "/signup", "/privacy", "/terms", "/data-deletion"].includes(request.nextUrl.pathname)) {
      return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, MARKETING_APP_ORIGIN), 307);
    }
    return new NextResponse("Page not found.", { status: 404, headers: { "X-Robots-Tag": "noindex", "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (isPlatformHost(hostname) && (request.nextUrl.pathname === "/marketing" || request.nextUrl.pathname === "/marketing/")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-newai-marketing", "1");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }
  request.headers.delete("x-newai-marketing");
  if (!isPlatformHost(hostname)) {
    const customerHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
    let domain;
    try { domain = await findPortalDomain(hostname); }
    catch { return new NextResponse("This portal is temporarily unavailable.", { status: 503, headers: customerHeaders }); }
    if (!domain || domain.status !== "connected") return new NextResponse("This portal domain is not connected.", { status: 404, headers: customerHeaders });
    if (request.nextUrl.pathname.startsWith("/customer/legacy/")) return new NextResponse("Page not found.", { status: 404, headers: customerHeaders });
    if (request.nextUrl.pathname === "/" || /^\/(account|pages\/[A-Za-z0-9_-]{1,64})$/.test(request.nextUrl.pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = `/customer/domain${request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname}`;
      return NextResponse.rewrite(url, { headers: customerHeaders });
    }
    if (!request.nextUrl.pathname.startsWith("/customer/") && !request.nextUrl.pathname.startsWith("/api/customer/")) return new NextResponse("Page not found.", { status: 404, headers: customerHeaders });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_vercel/insights(?:/|$)|_vercel/speed-insights(?:/|$)|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
