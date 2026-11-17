"use client";

import type { MouseEvent, ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import "./company-profile-sheet.css";

export function CompanyProfileSheet({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  function navigateWithinProfile(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href);
    if (url.origin !== window.location.origin || url.pathname !== `/companies/${encodeURIComponent(id)}` || url.hash) return;
    // Tabs, filters and pagination share one history entry so Close returns to the list.
    event.preventDefault();
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  return <Sheet open onOpenChange={next => { if (!next) router.back(); }}>
    <SheetContent side="bottom" className="company-profile-sheet" overlayClassName="company-profile-overlay" aria-describedby={undefined}>
      <SheetHeader className="company-profile-header"><SheetTitle>Company profile</SheetTitle></SheetHeader>
      <div className="company-profile-scroll scroll-surface" onClickCapture={navigateWithinProfile}><div className="company-profile-content">{children}</div></div>
    </SheetContent>
  </Sheet>;
}
