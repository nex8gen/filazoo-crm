"use client";

import type { MouseEvent, ReactNode } from "react";
import { LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useParams, useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import "./company-profile-sheet.css";

const loadMotionFeatures = () => import("@/lib/motion-features").then(features => features.default);

export function CompanyProfileSheet({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const reduceMotion = useReducedMotion();

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

  return <LazyMotion features={loadMotionFeatures}>
    <Sheet open onOpenChange={next => { if (!next) router.back(); }}>
      <SheetContent side="right" className="company-profile-sheet" overlayClassName="company-profile-overlay" aria-describedby={undefined}
        render={<m.div initial={{ x: reduceMotion ? 0 : "100%" }} animate={{ x: 0 }} transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.22, 1, 0.36, 1] }} />}>
        <SheetHeader className="company-profile-header"><SheetTitle>Company profile</SheetTitle></SheetHeader>
        <div className="company-profile-scroll scroll-surface" onClickCapture={navigateWithinProfile}><div className="company-profile-content">{children}</div></div>
      </SheetContent>
    </Sheet>
  </LazyMotion>;
}
