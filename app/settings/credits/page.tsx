import Link from "next/link";
import { ArrowUpRight, Building2, Package, Mail, Workflow, Play, HardDrive, Layers, Users, SlidersHorizontal, CircleAlert } from "lucide-react";
import { requireWorkspaceMember } from "@/lib/auth";
import { billingOverview } from "@/lib/billing/overview";
import { formatUsagePercent, usagePercent } from "@/lib/billing/credits";
import { findPlan } from "@/lib/billing/plans";
import { alipayReady } from "@/lib/billing/alipay";
import { CreditPackForm } from "@/app/subscribe/credit-pack-form";
import { readAiBudget } from "@/lib/ai/budget-server";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { CreditSummary } from "./credit-summary";
import { RefreshUsage } from "./refresh-usage";
import "./credits.css";

export const instant = false;
const resources = [
  { key: "companies", label: "Companies", icon: Building2 },
  { key: "products", label: "Products", icon: Package },
  { key: "mailboxes", label: "Email accounts", icon: Mail },
  { key: "flows", label: "Workflows", icon: Workflow },
  { key: "flowRuns", label: "Workflow runs this month", icon: Play },
  { key: "documentBytes", label: "File storage", icon: HardDrive },
] as const;

function count(value: number, bytes = false) {
  if (!bytes) return value.toLocaleString("en-US");
  const unit = value >= 1e9 ? "GB" : value >= 1e6 ? "MB" : value >= 1e3 ? "KB" : "B";
  const divisor = { GB: 1e9, MB: 1e6, KB: 1e3, B: 1 }[unit];
  return `${(value / divisor).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;
}

function Unavailable() {
  return <div className="settings-content billing-overview"><section className="billing-card billing-error" role="alert"><CircleAlert aria-hidden="true" /><h2>Unable to load usage</h2><p>Plan and credit usage are temporarily unavailable. Refresh to try again.</p><RefreshUsage /></section></div>;
}

export default async function CreditsSettingsPage() {
  const viewer = await requireWorkspaceMember();
  if (viewer.role !== "admin") {
    const limits = await withWorkspaceViewer(viewer, () => readAiBudget(viewer.id)).catch(() => null);
    if (!limits?.credits) return <Unavailable />;
    return <div className="settings-content billing-overview">
      <header className="billing-heading"><h2>Your workspace credits</h2><RefreshUsage /></header>
      <CreditSummary credits={limits.credits} />
      {limits.enabled === false ? <p role="status" className="billing-notice billing-notice-warning">AI is paused for your account. Contact an administrator to enable it.</p> : null}
      <p className="billing-small">Ask your workspace owner to purchase additional credits.</p>
    </div>;
  }
  const overview = await billingOverview(viewer).catch(() => null);
  if (!overview) return <Unavailable />;
  const subscriptionUrl = `/subscribe?workspace=${viewer.workspaceId}`;
  return <div className="settings-content billing-overview">
    <header className="billing-heading"><h2>Plan & usage</h2><RefreshUsage /></header>
    <div className="billing-summary-grid">
      <section className="billing-card billing-plan-card" aria-labelledby="current-plan-title">
        <div className="billing-card-heading"><h2 id="current-plan-title">Current plan</h2><span className={`billing-status${overview.active ? "" : " billing-status-inactive"}`}>{overview.active ? "Active" : "Inactive"}</span></div>
        <div className="billing-plan-name"><span className="billing-plan-icon"><Layers aria-hidden="true" /></span><h3>{overview.grandfathered ? "Beta" : findPlan(overview.plan)?.name ?? overview.plan}</h3></div>
        <p className="billing-plan-description">{overview.complimentary ? "Complimentary plan" : overview.grandfathered ? "Existing workspace terms" : "Monthly subscription"}</p>
        <div className="billing-seats"><Users aria-hidden="true" /><strong data-no-translate>{overview.seats}</strong><span>{overview.seats === 1 ? "user included" : "users included"}</span>{overview.memberCount != null ? <><span className="billing-separator">·</span><span data-no-translate>{overview.memberCount}</span><span>active members</span></> : null}</div>
        {!overview.active ? <p className="billing-small">Renew your workspace subscription to use AI credits.</p> : null}
        <Link href={subscriptionUrl} className="billing-button billing-plan-action"><span>Manage plan</span><ArrowUpRight aria-hidden="true" /></Link>
      </section>
      <CreditSummary credits={overview.credits} />
    </div>
    <section aria-labelledby="workspace-usage-title" className="billing-usage-section">
      <div className="billing-section-heading"><h2 id="workspace-usage-title">Workspace usage</h2><Link href={subscriptionUrl} className="billing-text-link">Compare plans<ArrowUpRight aria-hidden="true" /></Link></div>
      <div className="billing-resource-grid">{resources.map(({ key, label, icon: Icon }) => {
        const used = overview.usage[key] ?? 0;
        const cap = overview.limits[key];
        const percent = usagePercent(used, cap);
        const warning = percent != null && percent >= 90;
        return <article key={key} className={`billing-card billing-resource${warning ? " billing-resource-warning" : ""}`}>
          <h3><Icon aria-hidden="true" />{label}</h3>
          <p className="billing-resource-value"><strong data-no-translate>{count(used, key === "documentBytes")}</strong><span>/</span><span data-no-translate={cap != null ? true : undefined}>{cap == null ? "Custom" : count(cap, key === "documentBytes")}</span></p>
          {percent == null ? <div className="billing-meter" aria-hidden="true" /> : <div className={`billing-meter${warning ? " billing-meter-warning" : ""}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}
          <div className="billing-resource-caption">{key === "flowRuns" || key === "documentBytes" ? <span>{key === "flowRuns" ? "Resets monthly" : "Includes files in Trash"}</span> : null}{percent != null ? <span className="billing-resource-percent"><span data-no-translate>{formatUsagePercent(percent)}</span> <span>used</span></span> : null}</div>
          {warning ? <p role="status" className="billing-limit-note">{used >= (cap ?? 0) ? "Plan limit reached" : "Approaching plan limit"}</p> : null}
        </article>;
      })}</div>
    </section>
    <section className="billing-card billing-topup" aria-labelledby="add-credits-title">
      <div className="billing-topup-intro"><h2 id="add-credits-title">Add AI credits</h2><p>One-time top-up. No automatic charges.</p></div>
      {viewer.ownerId === viewer.id ? <CreditPackForm workspaceId={viewer.workspaceId} enabled={alipayReady() && overview.active} subscriptionActive={overview.active} /> : <p className="billing-small">Ask your workspace owner to purchase additional credits.</p>}
    </section>
    <footer className="billing-footer"><Link href={overview.creditOnly ? "/settings/ai#ai-policy" : "/settings/ai#ai-usage-controls"}><SlidersHorizontal aria-hidden="true" />AI settings</Link></footer>
  </div>;
}
