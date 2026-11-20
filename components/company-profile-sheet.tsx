"use client";

import { useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useParams, useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CompanyProfileReturnContext } from "@/components/company-profile-navigation";
import "./company-profile-sheet.css";

const loadMotionFeatures = () => import("@/lib/motion-features").then(features => features.default);

export function CompanyProfileSheet({ children, closeHref }: { children: ReactNode; closeHref?: string }) {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const reduceMotion = useReducedMotion();
  const returnHref = useContext(CompanyProfileReturnContext) ?? closeHref;
  const [open, setOpen] = useState(true);
  const actions = useRef<{ unmount(): void; close(): void } | null>(null);
  const closing = useRef(false);
  const navigated = useRef(false);

  const finishClose = useCallback(() => {
    if (!closing.current || navigated.current) return;
    navigated.current = true;
    actions.current?.unmount();
    if (returnHref) router.replace(returnHref, { scroll: false });
    else router.back();
  }, [returnHref, router]);

  // Ensure dismissal still completes if motion features are loading or interrupted.
  useEffect(() => {
    if (open) return;
    const timeout = window.setTimeout(finishClose, reduceMotion ? 0 : 450);
    return () => window.clearTimeout(timeout);
  }, [open, reduceMotion, finishClose]);

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
    <Sheet open={open} actionsRef={actions} onOpenChange={(next, details) => {
      if (next || closing.current) return;
      details.preventUnmountOnClose();
      closing.current = true;
      setOpen(false);
    }}>
      <SheetContent side="right" className="company-profile-sheet" overlayClassName="company-profile-overlay" aria-describedby={undefined}
        render={<m.div initial={{ x: reduceMotion ? 0 : "100%" }} animate={{ x: open || reduceMotion ? 0 : "100%" }} transition={{ duration: reduceMotion ? 0 : open ? 0.42 : 0.32, ease: open ? [0.22, 1, 0.36, 1] : [0.4, 0, 1, 1] }} onAnimationComplete={() => { if (!open) finishClose(); }} />}>
        <SheetTitle className="sr-only">Company profile</SheetTitle>
        <div className="company-profile-scroll" onClickCapture={navigateWithinProfile}><div className="company-profile-content">{children}</div></div>
      </SheetContent>
    </Sheet>
  </LazyMotion>;
}
