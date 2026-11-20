"use client";
import { useActionState } from "react";
import { plans } from "@/lib/billing/plans";
import { startCheckout } from "./actions";

export function PlanForm({ workspaceId, name, activePlan, enabled }: { workspaceId?: string; name?: string; activePlan?: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(startCheckout, {});
  return <form action={action} className="mt-8 space-y-6">
    {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : <div>
      <label htmlFor="workspace-name" className="mb-2 block text-sm font-medium">Workspace name</label>
      <input id="workspace-name" name="name" defaultValue={name} placeholder="Your business name" required minLength={2} maxLength={80} autoComplete="organization" className="w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700" />
    </div>}
    <fieldset><legend className="mb-3 text-sm font-medium">Choose your monthly plan</legend>
      <div className="grid gap-4 sm:grid-cols-2">{plans.map(plan => <label key={plan.id} className={`relative cursor-pointer rounded-2xl border border-slate-300 p-6 has-[:checked]:border-teal-600 has-[:checked]:ring-2 has-[:checked]:ring-teal-600 dark:border-slate-700 ${activePlan && activePlan !== plan.id ? "opacity-45" : ""}`}>
        <input type="radio" name="plan" value={plan.id} defaultChecked={plan.id === (activePlan || "starter")} disabled={Boolean(activePlan && activePlan !== plan.id)} className="absolute right-5 top-6 accent-teal-700" />
        <span className="block text-lg font-semibold">{plan.name}</span>
        <span className="my-4 block"><span className="text-4xl font-semibold tracking-tight">¥{plan.amountFen / 100}</span><span className="text-sm text-slate-500"> / month</span></span>
        <span className="block text-sm font-medium">{plan.members} {plan.members === 1 ? "member" : "members"}</span>
        <span className="mt-3 block text-sm leading-6 text-slate-500 dark:text-slate-400">{plan.description}</span>
      </label>)}</div>
    </fieldset>
    <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">Pay in RMB with Alipay. No free trial. Each payment adds one month of access. Renew manually whenever you need; there are no automatic charges. AI usage is subject to your workspace’s usage budget.</p>
    {activePlan && <p className="text-sm text-slate-500">Renew your current plan now. You can change plans after it expires.</p>}
    {!enabled && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">Alipay payments are being activated. Your account is ready; please check back shortly to subscribe.</p>}
    {state.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
    <button type="submit" disabled={pending || !enabled} className="w-full rounded-xl bg-teal-800 px-6 py-3.5 font-medium text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Preparing checkout…" : activePlan ? "Renew with Alipay →" : "Continue to Alipay →"}</button>
  </form>;
}
