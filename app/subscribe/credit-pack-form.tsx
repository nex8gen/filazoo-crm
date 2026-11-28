"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { startCreditRecharge, type RechargeState } from "./recharge-actions";
import { applyCreditDiscount } from "./discount-actions";
import { formatCredits, MICROS_PER_CREDIT } from "@/lib/billing/credits";
import { AI_CREDITS_CHANGED } from "@/lib/billing/credit-events";
import { maxRechargeCredits, parseRechargeCredits, rechargeAmountFen, type RechargePricing } from "@/lib/billing/recharge";

export function CreditPackForm({ workspaceId, enabled, subscriptionActive = true, pricing = null }: { workspaceId: string; enabled: boolean; subscriptionActive?: boolean; pricing?: RechargePricing | null }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [quantity, setQuantity] = useState("3000");
  const [code, setCode] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [checkingCode, checkCode] = useTransition();
  const [paymentNotice, setPaymentNotice] = useState(false);
  const inputId = useId();
  const free = appliedCode !== "" && appliedCode === code.trim().toUpperCase();
  const credits = parseRechargeCredits(quantity);
  const total = free ? 0 : credits != null && pricing ? rechargeAmountFen(credits, pricing.rateMicros) : null;
  const invalid = quantity !== "" && (credits == null || (free ? credits > Math.floor(Number.MAX_SAFE_INTEGER / MICROS_PER_CREDIT) : pricing != null && total == null));
  const [state, action, pending] = useActionState<RechargeState, FormData>(async (previous, form) => {
    requestId.current ??= crypto.randomUUID();
    form.set("requestId", requestId.current);
    const result = await startCreditRecharge(previous, form);
    if (result.success) {
      requestId.current = null;
      window.dispatchEvent(new Event(AI_CREDITS_CHANGED));
      router.refresh();
    } else if (result.error === "Alipay payment is not available at this time.") {
      setPaymentNotice(true);
      return {};
    }
    return result;
  }, {});

  function applyDiscount() {
    const submitted = code.trim().toUpperCase();
    setCodeError("");
    checkCode(async () => {
      try {
        const result = await applyCreditDiscount(workspaceId, submitted);
        if (result.discountPercent === 100) setAppliedCode(submitted);
        else { setAppliedCode(""); setCodeError(result.error ?? "Enter a valid discount code."); }
      } catch { setCodeError("Unable to check this code. Please try again."); }
    });
  }

  return <>
    <form action={action} className="billing-credit-purchase" aria-busy={pending} onSubmit={event => {
      if (code.trim() && !free) { event.preventDefault(); setCodeError("Apply your discount code first."); }
      else if (!enabled && !free) { event.preventDefault(); setPaymentNotice(true); }
    }}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="pricingId" value={pricing?.id ?? ""} />
      <input type="hidden" name="expectedAmountFen" value={total ?? ""} />
      <div className="billing-recharge-fields">
        <div className="billing-recharge-input">
          <label htmlFor={inputId}>Credits to add</label>
          <input id={inputId} name="credits" type="text" inputMode="numeric" pattern="[0-9]+" required value={quantity} disabled={pending} onChange={event => { setQuantity(event.target.value); requestId.current = null; }} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${inputId}-hint` : undefined} />
          {invalid ? <p id={`${inputId}-hint`} className="billing-purchase-error">{credits == null ? "Enter a positive whole number." : <>For this payment, enter up to <span data-no-translate>{formatCredits((free ? Math.floor(Number.MAX_SAFE_INTEGER / MICROS_PER_CREDIT) : maxRechargeCredits(pricing!.rateMicros)) * MICROS_PER_CREDIT)}</span> credits.</>}</p> : null}
        </div>
        <div className="billing-recharge-input">
          <label htmlFor={`${inputId}-code`}>Discount code</label>
          <div className="billing-discount-input"><input id={`${inputId}-code`} name="discountCode" type="text" autoComplete="off" spellCheck={false} maxLength={80} value={code} disabled={pending || checkingCode} onChange={event => { setCode(event.target.value); setAppliedCode(""); setCodeError(""); requestId.current = null; }} aria-invalid={Boolean(codeError) || undefined} aria-describedby={codeError || free ? `${inputId}-code-status` : undefined} /><button type="button" className="billing-button" disabled={pending || checkingCode || !code.trim() || free} onClick={applyDiscount}>{checkingCode ? "Checking…" : free ? "Applied" : "Apply"}</button></div>
          {codeError || free ? <p id={`${inputId}-code-status`} role={codeError ? "alert" : "status"} className={codeError ? "billing-purchase-error" : "billing-discount-applied"}>{codeError || "100% off"}</p> : null}
        </div>
      </div>
      <div className="billing-recharge-checkout">
        <div className="billing-pack-detail" aria-live="polite" aria-atomic="true"><span className="billing-small">Total</span><strong className="billing-pack-price" data-no-translate>{total == null ? "—" : `¥${(total / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong></div>
        <button type="submit" disabled={pending || checkingCode || credits == null || invalid || !subscriptionActive || (enabled && !free && total == null)} className="billing-button billing-button-primary">{pending ? "Recharging…" : free ? "Recharge for free" : "Recharge with Alipay"}</button>
      </div>
      {!subscriptionActive ? <p role="status" className="billing-purchase-error">Renew your workspace subscription to use AI credits.</p> : null}
      {!pricing && !free ? <p role="status" className="billing-small">Recharge pricing is temporarily unavailable. <button type="button" className="billing-refresh-pricing" onClick={() => router.refresh()}>Refresh pricing</button></p> : null}
      <p className="billing-recharge-terms">Credits expire after 12 months.</p>
      {state.error ? <div className="billing-recharge-error"><p role="alert" className="billing-purchase-error">{state.error}</p>{/pricing|total changed/i.test(state.error) ? <button type="button" className="billing-button billing-button-quiet" onClick={() => router.refresh()}>Refresh pricing</button> : null}</div> : null}
      {state.success && state.credits != null ? <p role="status" className="billing-discount-applied"><span data-no-translate>{formatCredits(state.credits * MICROS_PER_CREDIT)}</span> credits added.</p> : null}
    </form>
    <Dialog open={paymentNotice} onOpenChange={setPaymentNotice}>
      <DialogContent className="billing-payment-dialog"><DialogHeader><DialogTitle>Alipay payment</DialogTitle><DialogDescription>Alipay payment is not available at this time.</DialogDescription></DialogHeader><DialogFooter><DialogClose className="billing-button">Got it</DialogClose></DialogFooter></DialogContent>
    </Dialog>
  </>;
}
