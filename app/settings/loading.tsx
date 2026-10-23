"use client";

import { usePathname } from "next/navigation";
import { SettingsSkeleton } from "@/components/settings-skeleton";

export default function Loading() {
  const pathname = usePathname();
  return <SettingsSkeleton section={pathname.split("/")[2] || "general"} />;
}
