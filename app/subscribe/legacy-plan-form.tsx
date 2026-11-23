"use client";
import { useActionState } from "react";
import { legacyPlans } from "@/lib/billing/plans";
import { startCheckout } from "./actions";
export function LegacyPlanForm({ workspaceId, activePlan, enabled }: { workspaceId: string; activePlan: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(startCheckout, {});
  const plan = legacyPlans.find(value => value.id === activePlan);
  if (!plan) return null;
  return <form action={action} className="mt-8 space-y-4"><input name="workspaceId" type="hidden" value={workspaceId} /><input name="plan" type="hidden" value={plan.id} /><input name="legacy" type="hidden" value="1" /><p>{plan.name} · ¥{plan.amountFen / 100}/month · {plan.members} member(s). Existing pricing is retained.</p><button disabled={pending || !enabled} className="rounded-lg bg-teal-800 px-5 py-3 text-white disabled:opacity-50">{pending ? "Preparing checkout…" : "Renew legacy plan with Alipay"}</button>{state.error && <p role="alert">{state.error}</p>}</form>;
}
