import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer, getWorkspaceViewer } from "@/lib/auth";
import { listMyWorkspaces } from "@/lib/data/workspaces";
import { workspaceSubscription } from "@/lib/billing/data";
import { alipayReady } from "@/lib/billing/alipay";
import { findPlan } from "@/lib/billing/plans";
import { PlanForm } from "./plan-form";

export const metadata = { title: "Your subscription · Filazoo" };
export const instant = false;
export default async function SubscribePage({ searchParams }: { searchParams: Promise<{ workspace?: string; new?: string }> }) {
  const viewer = await requireViewer();
  const [params, workspaces, selected] = await Promise.all([searchParams, listMyWorkspaces(), getWorkspaceViewer()]);
  const workspace = params.new === "1" ? undefined : workspaces.find(w => w.id === (params.workspace || selected?.workspaceId)) || (!params.workspace ? workspaces[0] : undefined);
  if (params.workspace && !workspace) notFound();
  const subscription = workspace ? await workspaceSubscription(workspace.id) : null;
  const isOwner = !workspace || workspace.ownerId === viewer.id;
  const currentPlan = findPlan(subscription?.activePlan);
  return <main className="min-h-dvh bg-slate-50 px-5 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:py-16">
    <div className="mx-auto max-w-3xl"><header className="mb-10 flex items-center justify-between gap-4"><Link href="/workspaces" translate="no" data-no-translate className="text-xl font-bold tracking-tight text-teal-800 dark:text-teal-400">Filazoo<span className="font-normal">Supply</span></Link><Link href="/workspaces" className="text-sm text-slate-500 underline underline-offset-4">Your workspaces</Link></header>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-teal-700 dark:text-teal-400">{subscription?.grandfathered || currentPlan ? "Subscription" : "Account ready · Choose a plan"}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{workspace ? workspace.name : "Start your workspace"}</h1>
        <p className="mt-3 leading-7 text-slate-500 dark:text-slate-400">{subscription?.grandfathered ? "Your existing workspace keeps its current access." : currentPlan ? `${currentPlan.name} is active. Your access is paid through ${new Date(subscription!.paidUntil!).toLocaleDateString("en-GB", { timeZone: "Asia/Shanghai", day: "numeric", month: "long", year: "numeric" })}.` : "Choose a plan, scan the Alipay QR code, and start working as soon as payment is confirmed."}</p>
        {subscription?.grandfathered ? <Link href="/" className="mt-8 inline-block rounded-xl bg-teal-800 px-6 py-3 font-medium text-white">Open your workspace →</Link> : isOwner ? <PlanForm workspaceId={workspace?.id} activePlan={subscription?.activePlan} enabled={alipayReady()} /> : <p role="status" className="mt-6 rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-800">Ask your workspace owner to {currentPlan ? "manage" : "activate"} the subscription.</p>}
        {currentPlan && <Link href="/" className="mt-6 block text-center text-sm underline underline-offset-4">Continue to your workspace</Link>}
      </div><p className="mt-6 text-center text-xs text-slate-500">Secure payment through Alipay · <Link href="/terms" className="underline">Terms</Link> · <Link href="/privacy" className="underline">Privacy</Link></p>
    </div>
  </main>;
}
