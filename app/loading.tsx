"use client";

import { usePathname } from "next/navigation";
import { HomeSkeleton } from "@/components/home-skeleton";
import { LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  const pathname = usePathname();
  if (pathname === "/") return <HomeSkeleton />;
  // New routes without a dedicated boundary must not inherit Home's layout.
  return <LoadingRegion label="Loading page" className="w-full space-y-5 p-4"><Skeleton className="h-6 w-48 max-w-full" /><Skeleton className="h-1 w-full" /></LoadingRegion>;
}
