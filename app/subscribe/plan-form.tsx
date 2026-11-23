"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Check, CircleCheck, LockKeyhole, Minus, Plus, Users } from "lucide-react";
import { plans } from "@/lib/billing/plans";
import { startCheckout } from "./actions";

const number = (value: number) => value.toLocaleString("en-US");

export function PlanForm({ workspaceId, name, activePlan, activeSeats = 1, enabled }: { workspaceId?: string; name?: string; activePlan?: string; activeSeats?: number; enabled: boolean }) {
  const [state, action, pending] = useActionState(startCheckout, {});
  const [seats, setSeats] = useState(String(activeSeats));
  const [selectedPlan, setSelectedPlan] = useState(activePlan || "starter");
  const quantity = Number(seats);
  const validSeats = Number.isInteger(quantity) && quantity >= 1 && quantity <= 100;
  const displaySeats = validSeats ? quantity : 1;
  const selected = plans.find(plan => plan.id === selectedPlan) || plans[0];
  const locked = Boolean(activePlan);

  return <form action={action} className="subscription-form" aria-busy={pending}>
    <section className="subscription-setup" aria-label="Workspace details">
      <div className="subscription-setup-heading"><span className="subscription-step">01</span><div><h2>{workspaceId ? "Your team, together" : "Make it yours"}</h2><p>{workspaceId ? "Your current workspace subscription." : "A home for your business."}</p></div></div>
      {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : <div className="subscription-name-field"><label htmlFor="workspace-name">Workspace name</label><input id="workspace-name" name="name" defaultValue={name} placeholder="e.g. Acme Studio" required minLength={2} maxLength={80} autoComplete="organization" /></div>}
      <div className="subscription-seats-field"><label htmlFor="workspace-seats">Team size <span>including you</span></label><div className="subscription-seat-control"><Users aria-hidden="true" size={17} /><button type="button" aria-label="Remove a seat" disabled={locked || displaySeats <= 1} onClick={() => setSeats(String(Math.max(1, displaySeats - 1)))}><Minus size={15} /></button><input id="workspace-seats" name="seats" type="number" min={1} max={100} required readOnly={locked} value={seats} onChange={event => setSeats(event.target.value)} aria-describedby="subscription-seat-note" /><button type="button" aria-label="Add a seat" disabled={locked || displaySeats >= 100} onClick={() => setSeats(String(Math.min(100, displaySeats + 1)))}><Plus size={15} /></button></div></div>
    </section>
    <fieldset className="subscription-plan-picker">
      <legend className="subscription-plan-legend"><span className="subscription-step">02</span>Choose your plan</legend>
      <p id="subscription-seat-note" className="subscription-plan-caption">Monthly plans. Everything below is included per paid seat.</p>
      <div className="subscription-plan-grid">{plans.map(plan => {
        const checked = selectedPlan === plan.id;
        const disabled = Boolean(activePlan && activePlan !== plan.id);
        const features = [
          <><strong>{number(plan.companies)}</strong> customer companies</>,
          <><strong>{number(plan.products)}</strong> products</>,
          <><strong>{plan.mailboxes}</strong> connected {plan.mailboxes === 1 ? "mailbox" : "mailboxes"}</>,
          <><strong>{plan.flows}</strong> saved workflows</>,
          <><strong>{number(plan.flowRuns)}</strong> workflow starts / month</>,
          <><strong>{plan.documentBytes / 1e9} GB</strong> document storage</>,
        ];
        return <label key={plan.id} className="subscription-plan-card" data-plan={plan.id} data-selected={checked} data-disabled={disabled}>
          <input type="radio" name="plan" value={plan.id} checked={checked} onChange={() => setSelectedPlan(plan.id)} disabled={disabled} aria-label={`${plan.name} plan, $${plan.amountCents / 100} per seat per month`} className="subscription-plan-radio" />
          <div className="subscription-plan-top">
            <div className="subscription-plan-name"><h3>{plan.name}</h3><span className="subscription-selection" aria-hidden="true">{checked ? <Check size={13} /> : null}</span></div>
            <div className="subscription-plan-price"><span className="subscription-usd-price">${plan.amountCents / 100}</span><span>per seat<br />per month</span></div>
            <p className="subscription-plan-description">{plan.description}</p>
            <span className="subscription-plan-choice">{checked ? <><Check size={16} />{activePlan ? "Current plan" : "Selected plan"}</> : <>{activePlan ? "Unavailable during renewal" : `Choose ${plan.name}`}<ArrowRight size={16} /></>}</span>
            <span className="subscription-cny-price">Alipay checkout · ¥{plan.amountFen / 100} / seat / month</span>
          </div>
          <div className="subscription-plan-benefits"><div className="subscription-credit-feature"><span className="subscription-credit-icon" aria-hidden="true">✦</span><div><strong>{number(plan.credits)} AI credits</strong><span>per seat, every month</span></div></div><ul>{features.map((feature, index) => <li key={index}><CircleCheck aria-hidden="true" size={19} /><span>{feature}</span></li>)}</ul></div>
        </label>;
      })}</div>
    </fieldset>
    <div className="subscription-everything"><CircleCheck size={19} aria-hidden="true" /><p><strong>The whole toolkit, on every plan.</strong> CRM, email, products, quotations, invoices, tasks, workflows, reporting, and AI.</p></div>
    <section className="subscription-checkout" aria-label="Your plan summary">
      <div className="subscription-checkout-selection"><span className="subscription-checkout-mark" data-plan={selected.id} aria-hidden="true">✦</span><div><h2>{selected.name} <span>· {displaySeats} {displaySeats === 1 ? "seat" : "seats"}</span></h2><p>{number(selected.credits * displaySeats)} AI credits / month for your team</p></div></div>
      <div className="subscription-checkout-total" aria-live="polite" aria-atomic="true"><span>Monthly total</span><p>¥{number(selected.amountFen * displaySeats / 100)}<span> CNY</span></p></div>
      <button type="submit" disabled={pending || !enabled || !validSeats} className="subscription-checkout-button">{pending ? "Preparing checkout…" : activePlan ? "Renew with Alipay" : "Continue to Alipay"}<ArrowRight size={17} aria-hidden="true" /></button>
    </section>
    {!enabled ? <p role="status" className="subscription-payment-notice"><LockKeyhole size={15} aria-hidden="true" />Alipay payments are being activated. Please check back shortly.</p> : null}
    {state.error ? <p role="alert" className="subscription-error">{state.error}</p> : null}
    {activePlan ? <p className="subscription-renewal-note">Renew your current plan and seats. You can change them after the current subscription expires.</p> : null}
    <div className="subscription-fine-print"><p><strong>Simple, manual renewal.</strong> Each payment adds one month. No automatic charges. Pay in CNY through Alipay; USD prices are for reference. Card checkout is not available yet.</p><p><strong>More room, shared together.</strong> Credits and capacity are pooled across paid seats. AI credits expire each subscription month; larger tasks use more credits. Extra credits are sold separately. Existing role permissions apply.</p></div>
  </form>;
}
