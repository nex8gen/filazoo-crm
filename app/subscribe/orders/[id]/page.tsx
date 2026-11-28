import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, QrCode } from "lucide-react";
import { OnboardingShell } from "@/components/onboarding-shell";
import { requireViewer } from "@/lib/auth";
import { ownerOrder } from "@/lib/billing/data";
import { alipayReady, orderExpired } from "@/lib/billing/alipay";
import { orderProduct, yuan } from "@/lib/billing/plans";
import { PaymentStatus } from "./payment-status";
import styles from "@/components/onboarding-completion.module.css";

export const metadata = { title: "Subscription checkout · NewAI" };
export const instant = false;
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const order = await ownerOrder(viewer.id, (await params).id);
  if (!order) notFound();
  const expired = orderExpired(order);
  const paymentsEnabled = alipayReady();
  const payable = order.status === "pending" && !expired && paymentsEnabled;
  const discounted = Boolean(order.subscription_discount_id) && order.amount_fen === 0;
  const paid = order.status === "paid";
  const recharge = order.kind === "credits";
  const product = orderProduct(order);
  const users = order.seats ?? 1;
  const backHref = recharge ? "/settings/credits#add-ai-credits" : `/subscribe?workspace=${order.workspace_id}`;
  const title = paid ? recharge ? "Your credits are ready" : "Plan activated" : order.status === "refunded" ? "Payment refunded" : order.status === "closed" ? "Checkout closed" : expired ? "Checkout expired" : "Complete your payment";
  return <OnboardingShell step={recharge ? undefined : 2}>
    <div className={styles.checkout}>
      <Link href={backHref} className={styles.back}><ArrowLeft size={15} aria-hidden="true" />{recharge ? "AI credits" : "Subscription"}</Link>
      <section aria-labelledby="checkout-title">
        <div className={styles.intro}>
          <div className={paid ? styles.successIcon : styles.paymentIcon}>{paid ? <Check size={28} strokeWidth={1.75} aria-hidden="true" /> : <QrCode size={27} strokeWidth={1.5} aria-hidden="true" />}</div>
          <p className={styles.eyebrow}>{paid ? "You're all set" : "Your checkout"}</p>
          <h1 id="checkout-title" className={styles.title}>{title}</h1>
          <p className={styles.description}>{paid ? recharge ? "More room for your next idea. Your AI credits have been added." : "Your next chapter starts here. Your workspace is ready to go." : payable ? "One quick step to get everything in place. Pay securely with Alipay." : "Review your order details below."}</p>
        </div>
        <section className={styles.summary} aria-labelledby="order-summary-title">
          <div className={styles.summaryHeading}><h2 id="order-summary-title">{recharge ? "Credit recharge" : "Your subscription"}</h2>{paid ? <span className={styles.badge}>{discounted ? "100% off applied" : "Paid"}</span> : null}</div>
          <dl className={styles.details}>
            <div><dt>{recharge ? "Credits" : "Plan"}</dt><dd>{product?.name ?? (recharge ? "AI credits" : "Workspace subscription")}</dd></div>
            {!recharge ? <div><dt>{order.catalog_version === 4 || order.catalog_version === 6 ? "Included users" : "Users"}</dt><dd>{users} {users === 1 ? "user" : "users"}</dd></div> : null}
            <div><dt>{recharge ? "Valid for" : "Subscription period"}</dt><dd>{recharge ? "1 year" : order.period_months === 12 ? "12 months" : "1 month"}</dd></div>
            {discounted ? <div className={styles.discount}><dt>Discount</dt><dd>100%</dd></div> : null}
            <div className={styles.total}><dt>{paid ? "Total paid" : "Total due"}</dt><dd>¥{yuan(order.amount_fen)} <span className="text-xs font-normal">CNY</span></dd></div>
          </dl>
        </section>
        {payable ? <div className={styles.cashier}><p>Open Alipay and scan the QR code to pay.</p><iframe title="Alipay secure payment QR code" src={`/api/billing/orders/${order.id}/checkout`} referrerPolicy="no-referrer" className={styles.qr} /><a href={`/api/billing/orders/${order.id}/checkout`} target="_blank" rel="noopener noreferrer" className={styles.externalPayment}>Open Alipay in a new tab<ArrowUpRight size={14} aria-hidden="true" /></a></div> : null}
        {!paymentsEnabled && order.status === "pending" && !expired ? <p className={styles.note}>Alipay payments are temporarily unavailable. Please check back shortly.</p> : null}
        <PaymentStatus id={order.id} initialStatus={order.status} initialExpired={expired} workspaceId={order.workspace_id} kind={order.kind} discounted={discounted} />
        <p className={`${styles.note} ${styles.assurance}`}>{discounted ? "Your discount covers this subscription period. No payment required. No automatic renewal or charges." : recharge ? "One-time payment in RMB. Credits expire after one year. No automatic charges." : "One-time payment in RMB. No automatic renewal."}</p>
      </section>
    </div>
  </OnboardingShell>;
}
