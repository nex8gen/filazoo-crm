"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import "./product-profile-sheet.css";

const loadMotionFeatures = () => import("@/lib/motion-features").then(features => features.default);
const ProductProfileContext = createContext<{ close: () => void; setBusy: (busy: boolean) => void } | null>(null);

export function useProductProfileSheet() {
  return useContext(ProductProfileContext);
}

export function ProductSheet({ children, title, open, onOpenChange }: {
  children: ReactNode;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();

  return <LazyMotion features={loadMotionFeatures}>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="product-profile-sheet" overlayClassName="product-profile-overlay" aria-describedby={undefined}
        render={<m.div initial={{ x: reduceMotion ? 0 : "100%" }} animate={{ x: 0 }} transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.22, 1, 0.36, 1] }} />}>
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <div className="product-profile-scroll scroll-surface"><div className="product-profile-content">{children}</div></div>
      </SheetContent>
    </Sheet>
  </LazyMotion>;
}

export function ProductProfileSheet({ children, returnToCatalog = false }: { children: ReactNode; returnToCatalog?: boolean }) {
  const router = useRouter();
  const busy = useRef(false);
  const setBusy = useCallback((value: boolean) => { busy.current = value; }, []);
  const close = useCallback(() => {
    if (busy.current) return;
    if (returnToCatalog) router.replace("/products", { scroll: false });
    else router.back();
  }, [router, returnToCatalog]);
  const context = useMemo(() => ({ close, setBusy }), [close, setBusy]);

  return <ProductProfileContext value={context}>
    <ProductSheet title="Product details" open onOpenChange={open => { if (!open) close(); }}>{children}</ProductSheet>
  </ProductProfileContext>;
}
