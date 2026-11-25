"use client";

import { usePathname } from "next/navigation";
import { HomeSkeleton } from "@/components/home-skeleton";
import { PageLoadingSkeleton, PortalEditorSkeleton, WebsiteLoadingSkeleton } from "@/components/loading-skeletons";

export function RouteLoadingSkeleton({ fullScreen = false }: { fullScreen?: boolean }) {
  const pathname = usePathname();
  if (pathname.startsWith("/customer-portal/themes/")) return <PortalEditorSkeleton />;
  if (pathname.startsWith("/customer/domain") || pathname.startsWith("/pages/") || pathname === "/account") return <WebsiteLoadingSkeleton />;
  if (pathname === "/") return <HomeSkeleton />;
  return <PageLoadingSkeleton fullScreen={fullScreen} />;
}
