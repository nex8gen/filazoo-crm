import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { isPlatformHost, portalRequestHost } from "@/lib/portal-domains";
import { AccountPreferences } from "@/components/account-preferences";
import { AppShell } from "@/components/app-shell";
import { UserMenu } from "@/components/user-menu";

export async function WorkspaceSurface({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const hostname = portalRequestHost(requestHeaders.get("host") || "");
  // Rewritten public URLs such as / and /pages/about retain their browser URL.
  // Resolve the domain on the server so these pages never inherit the CRM shell.
  if (!isPlatformHost(hostname) || requestHeaders.get("x-filazoo-public-website") === "1" || requestHeaders.get("x-newai-marketing") === "1") return children;
  return <AccountPreferences><AppShell userMenu={<Suspense fallback={<span className="size-7 rounded-full bg-muted" />}><UserMenu /></Suspense>}>{children}</AppShell></AccountPreferences>;
}
