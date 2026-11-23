"use client";

import { Fragment, useActionState, useState } from "react";
import { ArrowRight, Check, ChevronDown, CircleCheck, LockKeyhole, Sparkles, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { plans, planPrice, type BillingPeriod } from "@/lib/billing/plans";
import { planFeatureGroups, type PlanFeature } from "@/lib/billing/features";
import { ALIPAY_ICON_PATH } from "@/lib/payment-icons";
import { startCheckout } from "./actions";

const number = (value: number) => value.toLocaleString("en-US");
const comparisonGroups: { title: string; rows: { label: string; value: (plan: typeof plans[number]) => string | true }[] }[] = [
  { title: "Workspace capacity", rows: [
    { label: "Included users", value: plan => number(plan.members) },
    { label: "AI credits / month", value: plan => number(plan.credits) },
    { label: "Customer companies", value: plan => number(plan.companies) },
    { label: "Products", value: plan => number(plan.products) },
    { label: "Connected mailboxes", value: plan => number(plan.mailboxes) },
    { label: "Saved workflows", value: plan => number(plan.flows) },
    { label: "Workflow starts / month", value: plan => number(plan.flowRuns) },
    { label: "Document storage", value: plan => `${plan.documentBytes / 1e9} GB` },
  ] },
];

function FeatureAvailability({ feature }: { feature: PlanFeature }) {
  switch (feature.availability) {
    case "credits": return <span className="subscription-feature-status"><Sparkles size={14} aria-hidden="true" /><span>Uses AI credits</span></span>;
    case "connection": return <span className="subscription-feature-status">Account required</span>;
    case "limited": return <span className="subscription-feature-status subscription-feature-limited">Limited access</span>;
    default: return <><Check size={17} aria-hidden="true" /><span className="sr-only">Included</span></>;
  }
}

export function PlanForm({ workspaceId, name, activePlan, activePeriod = "monthly", enabled }: { workspaceId?: string; name?: string; activePlan?: string; activePeriod?: BillingPeriod; enabled: boolean }) {
  const [state, action, pending] = useActionState(startCheckout, {});
  const [selectedPlan, setSelectedPlan] = useState(activePlan || "starter");
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(activePeriod);
  const [expandedFeatures, setExpandedFeatures] = useState<Record<string, boolean>>({ products: true });
  const allFeaturesExpanded = planFeatureGroups.every(group => expandedFeatures[group.id]);
  const annual = billingPeriod === "annual";
  const selected = plans.find(plan => plan.id === selectedPlan) || plans[0];
  const total = planPrice(selected, billingPeriod);
  const money = (value: number) => (value / 100).toLocaleString("en-US", { minimumFractionDigits: value % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const maxSavings = Math.max(...plans.map(plan => planPrice(plan, "annual").savingsFen));

  return <form action={action} className="subscription-form" aria-busy={pending}>
    <section aria-label="Workspace details"><Card className="subscription-setup">
      <div className="subscription-setup-heading"><span className="subscription-step">01</span><div><h2>{workspaceId ? "Your team, together" : "Make it yours"}</h2><p>{workspaceId ? "Your current workspace subscription." : "A home for your business."}</p></div></div>
      {workspaceId ? <input type="hidden" name="workspaceId" value={workspaceId} /> : <div className="subscription-name-field"><Label htmlFor="workspace-name">Workspace name</Label><Input id="workspace-name" name="name" defaultValue={name} placeholder="e.g. Acme Studio" required minLength={2} maxLength={80} autoComplete="organization" /></div>}
    </Card></section>
    <fieldset className="subscription-plan-picker">
      <legend className="subscription-plan-legend"><span className="subscription-step">02</span>Choose your plan</legend>
      <div className="subscription-plan-toolbar">
        <p id="subscription-seat-note" className="subscription-plan-caption">One workspace package. Users are included.</p>
        <fieldset className="subscription-billing-period" aria-label="Billing period" disabled={pending}>
          <label><input type="radio" name="billingPeriod" value="monthly" checked={!annual} onChange={() => setBillingPeriod("monthly")} /><span>Monthly</span></label>
          <label><input type="radio" name="billingPeriod" value="annual" checked={annual} onChange={() => setBillingPeriod("annual")} /><span>Annually <span className="subscription-annual-savings">Save up to {"\u00a5"}{money(maxSavings)}</span></span></label>
        </fieldset>
      </div>
      <div className="subscription-plan-grid">{plans.map(plan => {
        const checked = selectedPlan === plan.id;
        const price = planPrice(plan, billingPeriod);
        const disabled = Boolean(activePlan && activePlan !== plan.id);
        const features = [
          <><strong>{number(plan.companies)}</strong> customer companies</>,
          <><strong>{number(plan.products)}</strong> products</>,
          <><strong>{plan.mailboxes}</strong> connected {plan.mailboxes === 1 ? "mailbox" : "mailboxes"}</>,
          <><strong>{plan.flows}</strong> saved workflows</>,
          <><strong>{number(plan.flowRuns)}</strong> workflow starts / month</>,
          <><strong>{plan.documentBytes / 1e9} GB</strong> document storage</>,
        ];
        return <label key={plan.id} className="subscription-plan-option"><Card className="subscription-plan-card" data-plan={plan.id} data-selected={checked} data-disabled={disabled}>
          <input type="radio" name="plan" value={plan.id} checked={checked} onChange={() => setSelectedPlan(plan.id)} disabled={disabled} aria-label={`${plan.name} plan, $${money(price.monthlyCents)} per workspace per month${annual ? ", billed annually" : ""}`} className="subscription-plan-radio" />
          <div className="subscription-plan-top">
            <div className="subscription-plan-name"><h3>{plan.name}</h3><span className="subscription-selection" aria-hidden="true">{checked ? <Check size={13} /> : null}</span></div>
            <div className="subscription-plan-price"><span className="subscription-usd-price">${money(price.monthlyCents)}</span><span>per workspace<br />per month</span></div>
            <p className="subscription-plan-description">{plan.description}</p><p className="subscription-included-users"><Users aria-hidden="true" size={15} /><strong data-no-translate>{plan.members}</strong><span>{plan.members === 1 ? "user included" : "users included"}</span></p>
            <span className={`${buttonVariants({ variant: checked ? "default" : "outline" })} subscription-plan-choice`}>{checked ? <><Check size={16} />{activePlan ? "Current plan" : "Selected plan"}</> : <>{activePlan ? "Unavailable during renewal" : `Choose ${plan.name}`}<ArrowRight size={16} /></>}</span>
            <span className="subscription-cny-price">{annual ? `Billed annually: \u00a5${money(price.amountFen)} / workspace / year` : `Alipay checkout · ¥${money(price.amountFen)} / workspace / month`}</span>
          </div>
          <div className="subscription-plan-benefits"><div className="subscription-credit-feature"><span className="subscription-credit-icon" aria-hidden="true"><Sparkles size={18} /></span><div><strong>{number(plan.credits)} AI credits</strong><span>shared credits, every month</span></div></div><ul>{features.map((feature, index) => <li key={index}><CircleCheck aria-hidden="true" size={19} /><span>{feature}</span></li>)}</ul></div>
        </Card></label>;
      })}</div>
    </fieldset>
    <div className="subscription-everything"><CircleCheck size={19} aria-hidden="true" /><p><strong>The whole toolkit, on every plan.</strong> CRM, email, products, quotations, invoices, tasks, workflows, reporting, and AI.</p></div>
    <section className="subscription-comparison" aria-labelledby="subscription-comparison-title">
      <div className="subscription-comparison-heading">
        <h2 id="subscription-comparison-title">Find the right plan for you</h2>
        <p>Core features are included in every plan. Compare team size, shared credits and capacity.</p>
        <button type="button" className="subscription-feature-expand-all" aria-expanded={allFeaturesExpanded} aria-controls={planFeatureGroups.map(group => `feature-details-${group.id}`).join(" ")} onClick={() => setExpandedFeatures(Object.fromEntries(planFeatureGroups.map(group => [group.id, !allFeaturesExpanded])))}>{allFeaturesExpanded ? "Collapse feature details" : "Show all features"}</button>
      </div>
      <div className="subscription-comparison-frame" role="region" aria-label="Plan feature comparison, scroll horizontally to compare all plans" tabIndex={0}>
        <Table className="subscription-comparison-table">
          <TableCaption className="sr-only">Starter, Pro and Business workspace packages</TableCaption>
          <TableHeader><TableRow>
            <TableHead><span className="subscription-comparison-plan-name">Plan</span><div className="subscription-comparison-billing"><Switch id="comparison-annual" checked={annual} onCheckedChange={checked => setBillingPeriod(checked ? "annual" : "monthly")} disabled={pending} /><Label htmlFor="comparison-annual">Annually</Label></div></TableHead>
            {plans.map(plan => {
              const checked = selectedPlan === plan.id;
              const disabled = Boolean(activePlan && activePlan !== plan.id);
              const price = planPrice(plan, billingPeriod);
              return <TableHead key={plan.id} data-plan={plan.id} data-selected={checked}>
                <span className="subscription-comparison-plan-name">{plan.name}</span>
                <span className="subscription-comparison-price">${money(price.monthlyCents)} <span>/ workspace / month</span></span>
                <span className="subscription-comparison-charge">{"\u00a5"}{money(price.amountFen)} / workspace / {annual ? "year" : "month"}</span>
                <Button type="button" size="sm" variant={checked ? "default" : "outline"} aria-pressed={checked} aria-label={`Select ${plan.name} from comparison`} disabled={pending || disabled} onClick={() => setSelectedPlan(plan.id)}>
                  {checked ? <><Check aria-hidden="true" />{activePlan ? "Current plan" : "Selected plan"}</> : activePlan ? "Unavailable during renewal" : `Choose ${plan.name}`}
                </Button>
              </TableHead>;
            })}
          </TableRow></TableHeader>
          {comparisonGroups.map(group => <TableBody key={group.title}>
            <TableRow className="subscription-comparison-group"><TableHead scope="rowgroup" colSpan={4}>{group.title}</TableHead></TableRow>
            {group.rows.map(row => <TableRow key={row.label}>
              <TableHead scope="row">{row.label}</TableHead>
              {plans.map(plan => {
                const value = row.value(plan);
                return <TableCell key={plan.id} data-plan={plan.id} data-selected={selectedPlan === plan.id}>{value === true ? <><Check size={17} aria-hidden="true" /><span className="sr-only">Included</span></> : value}</TableCell>;
              })}
            </TableRow>)}
          </TableBody>)}
          {planFeatureGroups.map(group => <Fragment key={group.id}>
            <TableBody><TableRow className="subscription-comparison-group"><TableHead scope="rowgroup" colSpan={4}>
              <button type="button" id={`feature-heading-${group.id}`} className="subscription-feature-toggle" aria-expanded={Boolean(expandedFeatures[group.id])} aria-controls={`feature-details-${group.id}`} onClick={() => setExpandedFeatures(current => ({ ...current, [group.id]: !current[group.id] }))}>
                <ChevronDown size={15} aria-hidden="true" className={expandedFeatures[group.id] ? "" : "is-collapsed"} /><span>{group.title}</span><span className="subscription-feature-count" data-no-translate>{group.features.length}</span>
              </button>
            </TableHead></TableRow></TableBody>
            <TableBody id={`feature-details-${group.id}`} hidden={!expandedFeatures[group.id]} aria-labelledby={`feature-heading-${group.id}`}>
              {group.features.map(feature => <TableRow key={feature.id} data-feature={feature.id}>
                <TableHead scope="row"><span className="subscription-feature-label">{feature.label}{feature.beta ? <span className="subscription-feature-beta">Beta</span> : null}</span>{feature.note ? <span className="subscription-feature-note">{feature.note}</span> : null}</TableHead>
                {plans.map(plan => <TableCell key={plan.id} data-plan={plan.id} data-selected={selectedPlan === plan.id}><FeatureAvailability feature={feature} /></TableCell>)}
              </TableRow>)}
            </TableBody>
          </Fragment>)}
        </Table>
      </div>
      <p className="subscription-comparison-note">AI credits refresh monthly on both billing options. Annual plans are billed for 12 months upfront.</p>
      <p className="subscription-comparison-note">The owner counts toward the user limit. Feature access follows team roles. External accounts, provider fees and sending limits are separate.</p>
    </section>
    <section aria-label="Your plan summary" className="subscription-checkout-dock"><Card className="subscription-checkout"><div className="subscription-ticket-details" data-plan={selected.id}>
      <div className="subscription-checkout-selection"><span className="subscription-checkout-mark" data-plan={selected.id} aria-hidden="true"><Sparkles size={20} /></span><div><h2>{selected.name} <span>· {selected.members} {selected.members === 1 ? "user" : "users"}</span></h2><p>{number(selected.credits)} AI credits / month for your team</p></div></div>
    </div><div className="subscription-ticket-payment"><div className="subscription-checkout-row">
      <div className="subscription-checkout-total" aria-live="polite" aria-atomic="true"><span>{annual ? "Annual total" : "Monthly total"}</span><p>¥{money(total.amountFen)}<span> CNY</span></p></div>
      <Button type="submit" disabled={pending || !enabled} className="subscription-checkout-button"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="subscription-alipay-icon" fill="currentColor"><path d={ALIPAY_ICON_PATH} /></svg>{pending ? "Preparing checkout…" : activePlan ? "Renew with Alipay" : "Continue to Alipay"}<ArrowRight size={17} aria-hidden="true" /></Button>
    </div>
      {!enabled ? <p role="status" className="subscription-payment-notice"><LockKeyhole size={15} aria-hidden="true" />Alipay payments are being activated. Please check back shortly.</p> : null}
      {state.error ? <p role="alert" className="subscription-error">{state.error}</p> : null}
    </div><span className="subscription-ticket-perforation" aria-hidden="true" />
    </Card></section>
    {annual ? <p className="subscription-renewal-note">Save {"\u00a5"}{money(total.savingsFen)} per year for your workspace, compared with monthly billing. AI credits refresh monthly.</p> : null}
    {activePlan ? <p className="subscription-renewal-note">Renew your current package. You can change packages after the current subscription expires.</p> : null}
    <div className="subscription-fine-print"><p><strong>Simple, manual renewal.</strong> Each payment adds {annual ? "12 months" : "one month"}. No automatic charges. Pay in CNY through Alipay; USD prices are for reference. Card checkout is not available yet.</p><p><strong>More room, shared together.</strong> Included users, credits and capacity apply to your whole workspace. AI credits expire each subscription month; larger tasks use more credits. Extra credits are sold separately. Existing role permissions apply.</p></div>
  </form>;
}
