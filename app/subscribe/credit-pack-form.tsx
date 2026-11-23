"use client";
import { useActionState } from "react";
import { startCheckout } from "./actions";
import { creditPacks } from "@/lib/billing/plans";

export function CreditPackForm({ workspaceId, enabled, subscriptionActive = true }: { workspaceId: string; enabled: boolean; subscriptionActive?: boolean }) {
  const [state, action, pending] = useActionState(startCheckout, {});
  const pack = creditPacks[0];
  return <form action={action} className="billing-credit-purchase">
    <input type="hidden" name="workspaceId" value={workspaceId} /><input type="hidden" name="kind" value="credits" /><input type="hidden" name="plan" value={pack.id} /><input type="hidden" name="seats" value="1" />
    <div className="billing-pack-detail"><p><strong data-no-translate>{pack.credits.toLocaleString("en-US")}</strong> <span>AI credits</span><span className="billing-pack-price" data-no-translate>¥{pack.amountFen / 100}</span></p>{enabled ? <p className="billing-small">Valid for 12 months with an active subscription.</p> : null}</div>
    {enabled ? <button disabled={pending} className="billing-button billing-button-primary">{pending ? "Preparing checkout…" : "Buy credits with Alipay"}</button> : <p role="status" className="billing-purchase-unavailable">{subscriptionActive ? "Credit purchases are currently unavailable." : "Renew your workspace subscription to use AI credits."}</p>}
    {state.error && <p role="alert" className="billing-purchase-error">{state.error}</p>}
  </form>;
}
