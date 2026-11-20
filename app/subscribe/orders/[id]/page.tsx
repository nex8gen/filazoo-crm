import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { ownerOrder } from "@/lib/billing/data";
import { alipayReady, orderExpired } from "@/lib/billing/alipay";
import { findPlan, yuan } from "@/lib/billing/plans";
import { PaymentStatus } from "./payment-status";

export const metadata = { title: "Pay with Alipay · Filazoo" };
export const instant = false;
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const order = await ownerOrder(viewer.id, (await params).id);
  if (!order) notFound();
  const expired = orderExpired(order);
  const payable = order.status === "pending" && !expired && alipayReady();
  return <main className="min-h-dvh bg-slate-50 px-5 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100"><div className="mx-auto max-w-lg">
    <Link href={`/subscribe?workspace=${order.workspace_id}`} className="text-sm text-slate-500 underline underline-offset-4">← Subscription</Link>
    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-9">
      <p className="text-center text-sm font-medium text-teal-700 dark:text-teal-400">Filazoo {findPlan(order.plan_id)?.name} · 1 month</p>
      <h1 className="my-3 text-center text-3xl font-semibold">Pay ¥{yuan(order.amount_fen)}</h1>
      {payable && <><p className="mb-5 text-center text-sm text-slate-500">Open Alipay and scan the payment QR code below.</p><iframe title="Alipay secure payment QR code" src={`/api/billing/orders/${order.id}/checkout`} referrerPolicy="no-referrer" className="mx-auto h-[350px] w-full max-w-[300px] rounded-xl border border-slate-200 bg-white" /><a href={`/api/billing/orders/${order.id}/checkout`} target="_blank" rel="noopener noreferrer" className="mt-4 block text-center text-sm text-teal-700 underline underline-offset-4 dark:text-teal-400">Open Alipay payment in a new tab</a></>}
      {!alipayReady() && order.status === "pending" && <p className="mt-6 text-center text-sm text-slate-500">Alipay payments are temporarily unavailable. Please check back shortly.</p>}
      <PaymentStatus id={order.id} initialStatus={order.status} initialExpired={expired} workspaceId={order.workspace_id} />
      <p className="mt-7 text-center text-xs leading-5 text-slate-500">Access starts after Alipay confirms payment. One-time payment in RMB; no automatic renewal.</p>
    </section>
  </div></main>;
}
