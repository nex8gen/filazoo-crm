"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { loadCompanyPurchaseOrderDraft } from "@/app/company-purchase-order-actions";
import type { PurchaseOrderComposerHandle } from "@/components/purchase-order-composer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const Composer = dynamic(() => import("@/components/purchase-order-composer").then(module => module.PurchaseOrderComposer), {
  loading: () => <>
    <header className="flex items-center justify-between gap-4 border-b px-6 py-4"><h2 className="font-semibold">New purchase order</h2><SheetClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Close" />}><X className="size-4" /></SheetClose></header>
    <p role="status" className="p-6 text-sm text-muted-foreground">Loading order form…</p>
  </>,
});
type DraftContext = Awaited<ReturnType<typeof loadCompanyPurchaseOrderDraft>>;

export function CompanyPurchaseOrderCreate({ company, finalFocus, onClose, onSaved }: {
  company: { id: string; name: string };
  finalFocus?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSaved: (orderId: string) => void;
}) {
  const router = useRouter();
  const composerRef = useRef<PurchaseOrderComposerHandle>(null);
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<DraftContext | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCompanyPurchaseOrderDraft(company.id).then(result => {
      if (!cancelled) setContext(result);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [company.id, attempt]);

  function requestClose() {
    if (composerRef.current) composerRef.current.requestClose();
    else onClose();
  }

  return <Sheet open onOpenChange={open => { if (!open) requestClose(); }}>
    <SheetContent side="right" showCloseButton={false} finalFocus={finalFocus}
      className="w-full! max-w-[920px]! gap-0 overflow-y-auto p-0">
      <SheetTitle className="sr-only">New purchase order</SheetTitle>
      <SheetDescription className="sr-only">Create an order for this customer. Customer details are filled in from their saved profile.</SheetDescription>
      {context ? <Composer ref={composerRef} companies={[{ id: company.id, name: context.profile.customer.companyName }]}
        initialCompanyId={company.id} initialProfile={context.profile} initialBilling={context.billing} today={context.today}
        panel={{ onClose, onSaved: orderId => { onSaved(orderId); router.refresh(); } }} /> : <>
        <header className="flex items-center justify-between gap-4 border-b px-6 py-4"><div><h2 className="font-semibold">New purchase order</h2><p data-no-translate className="mt-1 text-sm text-muted-foreground">{company.name}</p></div><Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={requestClose}><X className="size-4" /></Button></header>
        <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
          {error ? <><p role="alert" className="text-sm text-destructive">Customer details could not be loaded. Please try again.</p><Button type="button" variant="outline" onClick={() => { setError(false); setAttempt(value => value + 1); }}>Retry</Button></> : <><Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden /><p role="status" className="text-sm text-muted-foreground">Loading customer details…</p></>}
        </div>
      </>}
    </SheetContent>
  </Sheet>;
}
