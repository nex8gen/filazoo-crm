import "server-only";
import { createSupabaseControl } from "../supabase/control.ts";
import { workspaceIdSchema } from "../workspaces.ts";
import { queryPayment } from "./alipay.ts";
import type { SubscriptionOrder } from "./plans.ts";

export async function ownerOrder(userId: string, id: string): Promise<SubscriptionOrder | null> {
  if (!workspaceIdSchema.safeParse(id).success) return null;
  const db = createSupabaseControl();
  const { data, error } = await db.from("subscription_orders").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Unable to load your payment. Please retry.");
  if (!data) return null;
  const owner = await db.from("workspaces").select("id").eq("id", data.workspace_id).eq("owner_id", userId).maybeSingle();
  if (owner.error) throw new Error("Unable to verify the workspace owner.");
  return owner.data ? data as SubscriptionOrder : null;
}
export async function settlePayment(payment: { outTradeNo: string; tradeNo: string; amount: number; status: string }) {
  if (!["TRADE_SUCCESS", "TRADE_FINISHED", "TRADE_CLOSED"].includes(payment.status)) return;
  const { error } = await createSupabaseControl().rpc("confirm_subscription_payment", {
    p_out_trade_no: payment.outTradeNo, p_trade_no: payment.tradeNo,
    p_amount_fen: payment.amount, p_status: payment.status,
  });
  if (error) throw new Error("Payment confirmation could not be saved.");
}
/** A database lease limits polling across tabs, processes, and server instances. */
export async function refreshPayment(order: SubscriptionOrder) {
  if (order.status !== "pending") return order;
  const db = createSupabaseControl();
  const now = new Date();
  const { data: lease, error } = await db.from("subscription_orders").update({ last_checked_at: now.toISOString() })
    .eq("id", order.id).eq("status", "pending")
    .or(`last_checked_at.is.null,last_checked_at.lt.${new Date(now.getTime() - 4500).toISOString()}`).select("id").maybeSingle();
  if (error) throw new Error("Unable to check payment status.");
  if (lease) {
    const result = await queryPayment(order);
    if (result) await settlePayment(result);
  }
  const current = await db.from("subscription_orders").select("*").eq("id", order.id).single();
  if (current.error) throw new Error("Unable to check payment status.");
  return current.data as SubscriptionOrder;
}
export async function workspaceSubscription(workspaceId: string) {
  const db = createSupabaseControl();
  const [subscription, payments, complimentary] = await Promise.all([
    db.from("workspace_subscriptions").select("grandfathered").eq("workspace_id", workspaceId).single(),
    db.from("subscription_orders").select("plan_id,period_end,period_start,catalog_version,seats,period_months").eq("workspace_id", workspaceId).eq("kind", "subscription").eq("status", "paid").order("period_end", { ascending: false }),
    db.rpc("read_complimentary_subscription", { p_workspace_id: workspaceId }),
  ]);
  if (subscription.error || payments.error || complimentary.error) throw new Error("Unable to load your subscription.");
  const now = Date.now();
  const active = payments.data.find(p => Date.parse(p.period_start) <= now && Date.parse(p.period_end) > now);
  const latest = payments.data[0];
  const gift = complimentary.data as { plan: string; seats: number; expiresAt: string | null; catalogVersion?: number } | null;
  return { billingPeriod: (active?.period_months === 12 ? "annual" : "monthly") as "annual" | "monthly", grandfathered: !gift && subscription.data.grandfathered as boolean, complimentary: Boolean(gift), activePlan: gift?.plan ?? active?.plan_id as string | undefined, seats: gift?.seats ?? active?.seats as number | undefined, catalogVersion: gift ? gift.catalogVersion ?? 2 : active?.catalog_version as number | undefined, legacyRenewalPlan: !gift && latest?.catalog_version === 1 ? latest.plan_id as string : undefined, paidUntil: latest?.period_end as string | undefined };
}
