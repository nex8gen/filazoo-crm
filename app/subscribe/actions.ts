"use server";
import { randomUUID } from "node:crypto";
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
  const viewer = await requireViewer();
  if (!alipayReady()) return { error: "Alipay payments are being activated. Please check back shortly." };
  const plan = findPlan(form.get("plan"));
  const legacy = form.get("legacy") === "1" ? legacyPlans.find(value => value.id === form.get("plan")) : undefined;
  const pack = creditPacks.find(value => value.id === form.get("plan"));
  const kind = form.get("kind") === "credits" ? "credits" : "subscription";
  const seats = Number(form.get("seats") || "1");
  const workspaceValue = form.get("workspaceId");
  const workspace = workspaceValue ? workspaceIdSchema.safeParse(workspaceValue) : null;
  const name = workspaceNameSchema.safeParse(form.get("name"));
  if (!(kind === "credits" ? pack && workspace?.success && seats === 1 : (plan || legacy) && Number.isSafeInteger(seats) && seats >= 1 && seats <= 100) || (workspace && !workspace.success) || (!workspace && !name.success)) return { error: "Choose a plan, 1–100 seats, and a valid workspace name." };
  if (legacy) {
    if (!workspace?.success || kind !== "subscription") return { error: "Choose an existing legacy workspace." };
    const current = await workspaceSubscription(workspace.data);
    if (current.legacyRenewalPlan !== legacy.id) return { error: "This legacy plan is only available for renewal." };
  }
  const args = {
    p_user_id: viewer.id, p_workspace_id: workspace?.success ? workspace.data : null,
    p_name: name.success ? name.data : "Workspace", p_plan_id: legacy?.id ?? (kind === "credits" ? pack!.id : plan!.id),
    p_out_trade_no: `FZ${randomUUID().replaceAll("-", "")}`,
  };
  const { data, error } = await createSupabaseControl().rpc(legacy ? "create_subscription_order" : "create_commercial_order", legacy ? args : { ...args, p_seats: seats, p_kind: kind });
  if (error) {
    const safe = ["This workspace has a complimentary subscription. No payment is required", "Verify your email before subscribing", "Workspace limit reached", "Renew the current plan and seats, or change them after expiry", "Your beta workspace already has access", "An active subscription is required", "This plan cannot hold your current team", "Too many checkout attempts. Please try again later", "Finish the existing checkout or wait for it to expire before changing plans"];
    return { error: safe.includes(error.message) ? error.message : "Unable to start checkout. Please try again." };
  }
  const order = data as SubscriptionOrder;
  if (!workspaceIdSchema.safeParse(order?.id).success || !workspaceIdSchema.safeParse(order?.workspace_id).success) return { error: "Unable to start checkout. Please try again." };
  (await cookies()).set(workspaceCookie, order.workspace_id, workspaceCookieOptions());
  redirect(`/subscribe/orders/${order.id}`);
}
