"use server";
import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema } from "@/lib/workspaces";
import { alipayReady } from "@/lib/billing/alipay";
import { creditPacks, findPlan, legacyPlans, type SubscriptionOrder } from "@/lib/billing/plans";
import { workspaceSubscription } from "@/lib/billing/data";

export type CheckoutState = { error?: string };
export async function startCheckout(_state: CheckoutState, form: FormData): Promise<CheckoutState> {
  const billingPeriod = form.get("billingPeriod") ?? "monthly";
  if (billingPeriod !== "monthly" && billingPeriod !== "annual") return { error: "Choose monthly or annual billing." };
  const viewer = await requireViewer();
  const discountValue = form.get("discountCode");
  const discountCode = typeof discountValue === "string" ? discountValue.trim().toUpperCase() : "";
  if ((discountValue != null && typeof discountValue !== "string") || (discountCode && !/^[A-Z0-9-]{6,80}$/.test(discountCode))) return { error: "Enter a valid discount code." };
  if (!discountCode && !alipayReady()) return { error: "Alipay payments are being activated. Please check back shortly." };
  // Older open tabs must not start a new fixed-price recharge after the change.
  // Their already-created pending orders retain the original signed total.
  if (form.get("kind") === "credits") return { error: "Open Plan & usage to choose a recharge amount." };
  let plan = findPlan(form.get("plan"));
  const legacy = form.get("legacy") === "1" ? legacyPlans.find(value => value.id === form.get("plan")) : undefined;
  const pack = creditPacks.find(value => value.id === form.get("plan"));
  const kind = form.get("kind") === "credits" ? "credits" : "subscription";
  if (billingPeriod === "annual" && (legacy || kind === "credits")) return { error: "Annual billing is available for current subscription plans only." };
  let seats: number = kind === "credits" ? 1 : plan?.members ?? 1;
  const workspaceValue = form.get("workspaceId");
  const workspace = workspaceValue ? workspaceIdSchema.safeParse(workspaceValue) : null;
  const name = workspaceNameSchema.safeParse(viewer.companyName ?? "My company");
  let renewVersion: number | undefined;
  let periodMonths = billingPeriod === "annual" ? 12 : 1;
  if (form.get("renewExisting") === "1") {
    if (!workspace?.success || kind !== "subscription" || legacy) return { error: "Choose an existing subscription to renew." };
    const current = await workspaceSubscription(workspace.data);
    if (![2, 3, 4].includes(current.catalogVersion ?? 0) || !current.activePlan || !current.seats) return { error: "Choose an existing subscription to renew." };
    renewVersion = current.catalogVersion; seats = current.seats;
    plan = findPlan(current.activePlan); periodMonths = current.billingPeriod === "annual" ? 12 : 1;
  }
  if (!(kind === "credits" ? pack && workspace?.success : plan || legacy) || (workspace && !workspace.success) || (!workspace && !name.success)) return { error: "Choose a valid plan and try again." };
  if (legacy) {
    if (!workspace?.success || kind !== "subscription") return { error: "Choose an existing legacy workspace." };
    const current = await workspaceSubscription(workspace.data);
    if (current.legacyRenewalPlan !== legacy.id) return { error: "This legacy plan is only available for renewal." };
  }
  if (discountCode && (legacy || kind !== "subscription" || renewVersion)) return { error: "Discount codes apply to current workspace packages only." };
  const args = {
    p_user_id: viewer.id, p_workspace_id: workspace?.success ? workspace.data : null,
    p_name: name.success ? name.data : "Workspace", p_plan_id: legacy?.id ?? (kind === "credits" ? pack!.id : plan!.id),
    p_out_trade_no: `FZ${randomUUID().replaceAll("-", "")}`,
  };
  const operation = discountCode ? "redeem_subscription_discount"
    : legacy ? "create_subscription_order"
    : kind === "credits" || renewVersion === 2 ? "create_commercial_order"
    : renewVersion === 3 ? "create_period_subscription_order"
    : renewVersion === 4 ? "create_package_subscription_order" : "create_current_package_subscription_order";
  const parameters = discountCode
    ? { ...args, p_period_months: periodMonths, p_code_hash: createHash("sha256").update(discountCode).digest("hex") }
    : legacy ? args : { ...args, p_seats: seats, p_kind: kind, ...(kind === "subscription" && renewVersion !== 2 ? { p_period_months: periodMonths } : {}) };
  const { data, error } = await createSupabaseControl().rpc(operation, parameters);
  if (error) {
    const safe = ["This workspace has a complimentary subscription. No payment is required", "Verify your email before subscribing", "Workspace limit reached", "Renew the current plan and seats, or change them after expiry", "Your beta workspace already has access", "An active subscription is required", "This plan cannot hold your current team", "Too many checkout attempts. Please try again later", "Finish the existing checkout or wait for it to expire before changing plans"];
    return { error: safe.includes(error.message) ? error.message : discountCode ? "Unable to activate this plan. Check your discount code and try again." : "Unable to start checkout. Please try again." };
  }
  const order = data as SubscriptionOrder;
  if (!workspaceIdSchema.safeParse(order?.id).success || !workspaceIdSchema.safeParse(order?.workspace_id).success) return { error: "Unable to start checkout. Please try again." };
  if (discountCode && (order.status !== "paid" || order.amount_fen !== 0 || !order.subscription_discount_id)) return { error: "Unable to confirm your discount. Please try again." };
  (await cookies()).set(workspaceCookie, order.workspace_id, workspaceCookieOptions());
  redirect(`/subscribe/orders/${order.id}`);
}
