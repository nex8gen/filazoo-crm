"use client";

import type { ReactNode } from "react";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { CompanyProfileSheet } from "@/components/company-profile-sheet";
import { isCompanyProfilePath } from "@/lib/company-tabs";

export default function CompanyProfileSlot({ children }: { children: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  const pathname = usePathname();
  // Parallel slots can retain their previous segment after the URL changes.
  if (!isCompanyProfilePath(pathname)) return null;

  // Keep one drawer mounted when a refreshed URL switches to intercepted navigation.
  return <CompanyProfileSheet closeHref={segment === "companies" ? "/companies" : undefined}>{children}</CompanyProfileSheet>;
}
