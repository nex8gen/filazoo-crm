import Link from "next/link";
import { ArrowUpRight, Building2, Package, Mail, Workflow, Send, HardDrive, Users, SlidersHorizontal, CircleAlert, ChevronDown } from "lucide-react";
import { requireWorkspaceMember } from "@/lib/auth";
import { billingOverview } from "@/lib/billing/overview";
import { formatCredits, MICROS_PER_CREDIT, formatUsagePercent, usagePercent } from "@/lib/billing/credits";
import { findPlan, plans } from "@/lib/billing/plans";
import { alipayReady } from "@/lib/billing/alipay";
import { getRechargePricing } from "@/lib/billing/recharge-pricing";
import { CreditPackForm } from "@/app/subscribe/credit-pack-form";
import { readAiBudget } from "@/lib/ai/budget-server";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { CreditSummary } from "./credit-summary";
import { RefreshUsage } from "./refresh-usage";
import "./credits.css";

export const instant = false;
const resources = [
  { key: "companies", label: "Companies", icon: Building2, href: "/companies" },
  { key: "products", label: "Products", icon: Package, href: "/products" },
  { key: "mailboxes", label: "Email accounts", icon: Mail, href: "/settings/apps?view=team" },
  { key: "flows", label: "Workflows", icon: Workflow, href: "/workflow" },
  { key: "workflowEmails", label: "Workflow emails / month", icon: Send, href: "/workflow" },
  { key: "documentBytes", label: "File storage", icon: HardDrive, href: "/documents" },
] as const;

function count(value: number, bytes = false) {
  if (!bytes) return value.toLocaleString("en-US");
  const unit = value >= 1e9 ? "GB" : value >= 1e6 ? "MB" : value >= 1e3 ? "KB" : "B";
  const divisor = { GB: 1e9, MB: 1e6, KB: 1e3, B: 1 }[unit];
  return `${(value / divisor).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}

function Unavailable() {
  return <div className="settings-content billing-overview"><header className="billing-heading"><h1>Plan & usage</h1></header><section className="billing-card billing-error" role="alert"><CircleAlert aria-hidden="true" /><h2>Unable to load usage</h2><p>Plan and credit usage are temporarily unavailable. Refresh to try again.</p><RefreshUsage /></section></div>;
}

export default async function CreditsSettingsPage() {
  const viewer = await requireWorkspaceMember();
  if (viewer.role !== "admin") {
    const limits = await withWorkspaceViewer(viewer, () => readAiBudget(viewer.id)).catch(() => null);
    if (!limits?.credits) return <Unavailable />;
    return <div className="settings-content billing-overview">
      <header className="billing-heading"><h1>Your workspace credits</h1><RefreshUsage /></header>
      <CreditSummary credits={limits.credits} />
      {limits.enabled === false ? <p role="status" className="billing-notice billing-notice-warning">AI is paused for your account. Contact an administrator to enable it.</p> : null}
      <p className="billing-small">Ask your workspace owner to purchase additional credits.</p>
    </div>;
  }
  const overview = await billingOverview(viewer).catch(() => null);
  if (!overview) return <Unavailable />;
  const subscriptionUrl = `/subscribe?workspace=${viewer.workspaceId}`;
  const isOwner = viewer.ownerId === viewer.id;
  const canManageSubscription = isOwner && !overview.complimentary && !overview.grandfathered;
  const rechargePricing = isOwner ? await getRechargePricing().catch(() => null) : null;
  const purchasesAvailable = isOwner && alipayReady() && overview.active;
  const aiSettingsUrl = overview.creditOnly ? "/settings/ai#ai-policy" : "/settings/ai#ai-usage-controls";
  return <div className="settings-content billing-overview">
    <header className="billing-heading"><h1>Plan & usage</h1><RefreshUsage /></header>
    <section className="settings-form-row billing-plan-row" aria-labelledby="current-plan-title">
      <div className="settings-row-heading"><h2 id="current-plan-title">Current plan</h2><p>Your workspace subscription.</p></div>
      <section className="billing-card billing-plan-card" aria-labelledby="current-plan-title">
        <div className="billing-plan-name"><h3>{overview.grandfathered ? "Beta" : findPlan(overview.plan)?.name ?? overview.plan}</h3><span className={`billing-status${overview.active ? "" : " billing-status-inactive"}`}>{overview.active ? "Active" : "Inactive"}</span></div>
        <p className="billing-plan-description">{overview.complimentary ? "Complimentary plan" : overview.grandfathered ? "Existing workspace terms" : "Workspace subscription"}</p>
        <div className="billing-seats"><Users aria-hidden="true" /><strong data-no-translate>{overview.seats}</strong><span>{overview.seats === 1 ? "user included" : "users included"}</span>{overview.memberCount != null ? <><span className="billing-separator">·</span><span data-no-translate>{overview.memberCount}</span><span>active members</span></> : null}</div>
        {!overview.active ? <p className="billing-small">Renew your workspace subscription to use AI credits.</p> : null}
        {canManageSubscription ? <Link href={subscriptionUrl} className="billing-button billing-plan-action"><span>{overview.active ? "Manage subscription" : "Renew subscription"}</span><ArrowUpRight aria-hidden="true" /></Link> : null}
        {!isOwner ? <p className="billing-small">Your workspace owner manages the subscription.</p> : null}
      </section>
    </section>
    <CreditSummary credits={overview.credits} />
    <section className="settings-form-row billing-topup" id="add-ai-credits" aria-labelledby="add-credits-title">
      <div className="settings-row-heading billing-topup-intro"><h2 id="add-credits-title">Recharge AI credits</h2></div>
      {isOwner ? <CreditPackForm workspaceId={viewer.workspaceId} enabled={purchasesAvailable} subscriptionActive={overview.active} pricing={rechargePricing} /> : <p className="billing-small">Ask your workspace owner to purchase additional credits.</p>}
    </section>
    <section aria-labelledby="workspace-usage-title" className="settings-form-row billing-usage-row">
      <div className="settings-row-heading"><h2 id="workspace-usage-title">Workspace usage</h2></div>
      <div className="billing-card billing-usage-section">
      <div className="billing-resource-columns" aria-hidden="true"><span>Resource</span><div className="billing-resource-data"><span>Used / limit</span><span>Usage</span></div><span>Action</span></div>
      <div className="billing-resource-grid">{resources.map(({ key, label, icon: Icon, href }) => {
        const used = overview.usage[key] ?? 0;
        const cap = overview.limits[key];
        const percent = usagePercent(used, cap);
        const warning = percent != null && percent >= 90;
        const atLimit = warning && used >= (cap ?? 0);
        return <article key={key} className={`billing-resource${warning ? " billing-resource-warning" : ""}`}>
          <div className="billing-resource-title"><Icon aria-hidden="true" /><h3>{label}{warning ? <span className="billing-limit-note">{atLimit ? "At limit" : "Nearly full"}</span> : null}</h3></div>
          <div className="billing-resource-data">
          <p className="billing-resource-value"><strong data-no-translate>{count(used, key === "documentBytes")}</strong><span>/</span><span data-no-translate={cap != null ? true : undefined}>{cap == null ? key === "workflowEmails" ? "No package limit" : "Custom" : count(cap, key === "documentBytes")}</span></p>
          <div className="billing-resource-progress">{percent == null ? <span className="billing-small">{key === "workflowEmails" ? "Provider limits still apply" : "Custom limit"}</span> : <><div className={`billing-meter${warning ? " billing-meter-warning" : ""}`} role="progressbar" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div><span className="billing-resource-percent" data-no-translate>{formatUsagePercent(percent)}</span></>}</div>
          </div>
          <Link href={href} aria-label={`Manage ${label.toLowerCase()}`} className="billing-resource-action">Manage<ArrowUpRight aria-hidden="true" /></Link>
        </article>;
      })}</div></div>
    </section>
    <details className="billing-card billing-comparison">
      <summary id="billing-plan-comparison"><span className="billing-comparison-title">Compare plans</span><ChevronDown aria-hidden="true" /></summary>
      <div className="billing-comparison-scroll" tabIndex={0} role="region" aria-label="Plan comparison"><table><caption>Current workspace packages. Existing and complimentary workspace terms may differ. Prices shown in CNY, billed monthly.</caption><thead><tr><th scope="col">Included in your plan</th>{plans.map(plan => <th scope="col" key={plan.id}>{plan.name}{overview.plan === plan.id && !overview.grandfathered ? <span className="billing-small">{overview.complimentary ? "Complimentary access" : "Your plan"}</span> : null}<span className="billing-comparison-price"><span data-no-translate>¥{plan.amountFen / 100}</span><small> / month</small></span></th>)}</tr></thead><tbody>
        <tr><th scope="row">Included users</th>{plans.map(plan => <td key={plan.id} data-no-translate>{plan.members}</td>)}</tr>
        <tr><th scope="row">Monthly AI credits</th>{plans.map(plan => <td key={plan.id} data-no-translate>{formatCredits(plan.credits * MICROS_PER_CREDIT)}</td>)}</tr>
        {resources.map(({ key, label }) => <tr key={key}><th scope="row">{label}</th>{plans.map(plan => <td key={plan.id} data-no-translate>{count(plan[key], key === "documentBytes")}</td>)}</tr>)}
      </tbody></table></div>
    </details>
    <footer className="billing-footer"><Link href={aiSettingsUrl}><SlidersHorizontal aria-hidden="true" />AI settings</Link></footer>
  </div>;
}
