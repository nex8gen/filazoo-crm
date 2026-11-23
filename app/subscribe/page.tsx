import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, LockKeyhole } from "lucide-react";
import { BrandMarkIcon } from "@/components/brand-mark";
import { requireViewer, getWorkspaceViewer } from "@/lib/auth";
import { listMyWorkspaces } from "@/lib/data/workspaces";
import { workspaceSubscription } from "@/lib/billing/data";
import { alipayReady } from "@/lib/billing/alipay";
import { findPlan, legacyPlans } from "@/lib/billing/plans";
import { PlanForm } from "./plan-form";
import { LegacyPlanForm } from "./legacy-plan-form";
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
    <div className="subscription-container">
      <header className="subscription-header"><Link href="/workspaces" translate="no" data-no-translate className="subscription-brand"><BrandMarkIcon aria-hidden="true" /><span>Filazoo</span></Link><Link href="/workspaces" className="subscription-back"><ArrowLeft size={15} aria-hidden="true" />Your workspaces</Link></header>
      <section className="subscription-hero">
        <p className="subscription-eyebrow"><span />{subscription?.grandfathered || currentPlan ? "YOUR WORKSPACE, CONNECTED" : "ACCOUNT READY. NEXT CHAPTER AHEAD."}</p>
        <h1>{workspace ? workspace.name : <>Big plans for<br className="subscription-mobile-break" /> your business.</>}</h1>
        <p className="subscription-intro">{subscription?.complimentary ? "Your complimentary subscription is active. No subscription payment or renewal is required." : subscription?.grandfathered ? "Your existing workspace keeps its current access." : currentPlan ? `${currentPlan.name} is active. Your access is paid through ${new Date(subscription!.paidUntil!).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "long", year: "numeric" })}.` : "Your customers, conversations, and team. One connected workspace, with room to grow."}</p>
        {!workspace ? <div className="subscription-progress" aria-label="Account setup progress"><span><Check size={13} aria-hidden="true" />Account</span><i aria-hidden="true" /><span aria-current="step">Workspace</span><i aria-hidden="true" /><span>Get started</span></div> : null}
      </section>
      {subscription?.complimentary ? <div className="subscription-access"><Link href="/settings/credits">View complimentary plan and credits<ArrowUpRight size={16} /></Link></div> : subscription?.grandfathered ? <div className="subscription-access"><Link href="/settings/credits">View beta credits and usage<ArrowUpRight size={16} /></Link></div> : isOwner ? workspace && subscription?.legacyRenewalPlan ? <LegacyPlanForm workspaceId={workspace.id} activePlan={subscription.legacyRenewalPlan} enabled={alipayReady()} /> : <PlanForm workspaceId={workspace?.id} activePlan={subscription?.activePlan} activeSeats={subscription?.seats} enabled={alipayReady()} /> : <p role="status" className="subscription-owner-notice">Ask your workspace owner to {currentPlan ? "manage" : "activate"} the subscription.</p>}
      {currentPlan ? <Link href="/" className="subscription-continue">Continue to your workspace<ArrowUpRight size={15} aria-hidden="true" /></Link> : null}
      <footer className="subscription-footer"><p><LockKeyhole size={13} aria-hidden="true" />Secure checkout with Alipay</p><span>Your business. Your team. Your workspace.</span><div><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div></footer>
    </div>
  </main>;
}
