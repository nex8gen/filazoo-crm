"use client";

import { usePathname } from "next/navigation";
import { AppLoading } from "@/components/app-loading";
import { AuthSkeleton } from "@/components/auth-skeleton";
import { isStandaloneRoute } from "@/lib/standalone-routes";
import { HomeSkeleton } from "@/components/home-skeleton";
import { PageLoadingSkeleton, PortalEditorSkeleton, WebsiteLoadingSkeleton } from "@/components/loading-skeletons";

export function RouteLoadingSkeleton({ fullScreen = false }: { fullScreen?: boolean }) {
  const pathname = usePathname();
  if (!pathname) return <AppLoading fullScreen={fullScreen} />;
  if (pathname === "/login" || pathname === "/login/") return <AuthSkeleton variant="signin" />;
  if (pathname === "/signup" || pathname === "/signup/") return <AuthSkeleton fields={5} variant="signup" />;
  if (pathname.startsWith("/signup/")) return <AuthSkeleton fields={1} />;
  if (pathname.startsWith("/customer-portal/themes/")) return <PortalEditorSkeleton />;
  if (pathname.startsWith("/customer/domain") || pathname.startsWith("/pages/") || pathname === "/account") return <WebsiteLoadingSkeleton />;
  if (isStandaloneRoute(pathname)) return <AppLoading fullScreen />;
  if (pathname === "/") return <HomeSkeleton />;
  return <PageLoadingSkeleton fullScreen={fullScreen} />;
}
