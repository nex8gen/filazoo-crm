"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { orderProduct, yuan } from "@/lib/billing/plans";
import { startCheckout } from "./actions";

export function ExistingPlanForm({ workspaceId, plan, seats, catalogVersion, annual, enabled }: { workspaceId: string; plan: string; seats: number; catalogVersion: number; annual: boolean; enabled: boolean }) {
  const [state, action, pending] = useActionState(startCheckout, {});
  const product = orderProduct({ plan_id: plan as "starter" | "pro" | "business", catalog_version: catalogVersion, kind: "subscription", seats, period_months: annual ? 12 : 1 });
  if (!product) return null;
  return <form action={action} className="subscription-form">
    <input type="hidden" name="workspaceId" value={workspaceId} /><input type="hidden" name="renewExisting" value="1" />
    <section className="subscription-checkout"><div className="subscription-checkout-selection"><div><h2>{product.name}</h2><p><span data-no-translate>{seats}</span> <span>included users</span></p><p>Existing subscription pricing is retained.</p></div></div><div className="subscription-checkout-total"><span>{annual ? "Annual total" : "Monthly total"}</span><p data-no-translate>¥{yuan(product.amountFen)}</p></div><Button type="submit" disabled={pending || !enabled} className="subscription-checkout-button" data-payment="alipay">{pending ? "Preparing checkout…" : "Renew with Alipay"}</Button></section>
    {!enabled ? <p role="status" className="subscription-payment-notice">Alipay payments are being activated. Please check back shortly.</p> : null}
    {state.error ? <p role="alert" className="subscription-error">{state.error}</p> : null}
  </form>;
}
