import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { NextResponse } from "next/server";
import { isPlatformHost, portalRequestHost } from "@/lib/portal-domains";
import { findPortalDomain } from "@/lib/data/portal-domain-routing";

export async function proxy(request: NextRequest) {
  const hostname = portalRequestHost(request.headers.get("host") || request.nextUrl.host);
  if (!isPlatformHost(hostname)) {
    const customerHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
    let domain;
    try { domain = await findPortalDomain(hostname); }
    catch { return new NextResponse("This portal is temporarily unavailable.", { status: 503, headers: customerHeaders }); }
    if (!domain || domain.status !== "connected") return new NextResponse("This portal domain is not connected.", { status: 404, headers: customerHeaders });
    if (request.nextUrl.pathname.startsWith("/customer/legacy/")) return new NextResponse("Page not found.", { status: 404, headers: customerHeaders });
    if (request.nextUrl.pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/customer/domain";
      return NextResponse.rewrite(url, { headers: customerHeaders });
    }
    if (!request.nextUrl.pathname.startsWith("/customer/") && !request.nextUrl.pathname.startsWith("/api/customer/")) return new NextResponse("Page not found.", { status: 404, headers: customerHeaders });
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|_vercel/insights(?:/|$)|_vercel/speed-insights(?:/|$)|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
