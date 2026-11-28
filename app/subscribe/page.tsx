import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, LockKeyhole, X } from "lucide-react";
import { AccountSetupProgress } from "@/components/account-setup-progress";
import { buttonVariants } from "@/components/ui/button";
import { requireViewer, getWorkspaceViewer } from "@/lib/auth";
import { listMyWorkspaces } from "@/lib/data/workspaces";
import { workspaceSubscription } from "@/lib/billing/data";
import { alipayReady } from "@/lib/billing/alipay";
import { findPlan, legacyPlans } from "@/lib/billing/plans";
import { PlanForm } from "./plan-form";
import { LegacyPlanForm } from "./legacy-plan-form";
import { ExistingPlanForm } from "./existing-plan-form";
import "./subscribe.css";

export const metadata = { title: "Your subscription · Filazoo" };
export const instant = false;

export default async function SubscribePage({ searchParams }: { searchParams: Promise<{ workspace?: string; new?: string }> }) {
  const viewer = await requireViewer();
  const [params, workspaces, selected] = await Promise.all([searchParams, listMyWorkspaces(), getWorkspaceViewer()]);
  const workspace = params.new === "1" ? undefined : workspaces.find(w => w.id === (params.workspace || selected?.workspaceId)) || (!params.workspace ? workspaces[0] : undefined);
  if (params.workspace && !workspace) notFound();
  const subscription = workspace ? await workspaceSubscription(workspace.id) : null;
  const isOwner = !workspace || workspace.ownerId === viewer.id;
  const currentPlan = subscription?.catalogVersion === 1 ? legacyPlans.find(plan => plan.id === subscription.activePlan) : findPlan(subscription?.activePlan);

  return <main className="subscription-page">
    <header className="subscription-header"><Link href="/workspaces" className="subscription-close" aria-label="Close subscription"><X size={18} aria-hidden="true" /></Link></header>
    <div className="subscription-container">
      <section className="subscription-hero">
        <p className="subscription-eyebrow">{subscription?.grandfathered || currentPlan ? "Workspace subscription" : "Your plan"}</p>
        <h1>{currentPlan && workspace ? workspace.name : "A plan for your business"}</h1>
        <p className="subscription-intro">{subscription?.complimentary ? "Your complimentary subscription is active. No subscription payment or renewal is required." : subscription?.grandfathered ? "Your existing workspace keeps its current access." : currentPlan ? `${currentPlan.name} is active. Your access is paid through ${new Date(subscription!.paidUntil!).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "long", year: "numeric" })}.` : "Your customers, conversations, and team. One connected workspace, with room to grow."}</p>
        {!currentPlan && !subscription?.grandfathered ? <AccountSetupProgress current={2} className="subscription-progress" /> : null}
      </section>
      {subscription?.complimentary ? <div className="subscription-access"><Link href="/settings/credits" className={buttonVariants()}>View complimentary plan and credits<ArrowUpRight size={16} /></Link></div> : subscription?.grandfathered ? <div className="subscription-access"><Link href="/settings/credits" className={buttonVariants()}>View beta credits and usage<ArrowUpRight size={16} /></Link></div> : isOwner ? workspace && subscription?.legacyRenewalPlan ? <LegacyPlanForm workspaceId={workspace.id} activePlan={subscription.legacyRenewalPlan} enabled={alipayReady()} /> : workspace && subscription?.activePlan && [2, 3, 4].includes(subscription.catalogVersion ?? 0) ? <ExistingPlanForm workspaceId={workspace.id} plan={subscription.activePlan} seats={subscription.seats ?? 1} catalogVersion={subscription.catalogVersion!} annual={subscription.billingPeriod === "annual"} enabled={alipayReady()} /> : <PlanForm workspaceId={workspace?.id} activePlan={subscription?.activePlan} activePeriod={subscription?.billingPeriod} enabled={alipayReady()} /> : <p role="status" className="subscription-owner-notice">Ask your workspace owner to {currentPlan ? "manage" : "activate"} the subscription.</p>}
      {currentPlan ? <Link href="/" className="subscription-continue">Continue to your workspace<ArrowUpRight size={15} aria-hidden="true" /></Link> : null}
      <footer className="subscription-footer"><p><LockKeyhole size={13} aria-hidden="true" />Secure checkout with Alipay</p><span>Your business. Your team. Your workspace.</span><div><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div></footer>
    </div>
  </main>;
}
