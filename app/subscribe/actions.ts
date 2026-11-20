"use server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema } from "@/lib/workspaces";
import { alipayReady } from "@/lib/billing/alipay";
import { findPlan, type SubscriptionOrder } from "@/lib/billing/plans";

export type CheckoutState = { error?: string };
export async function startCheckout(_state: CheckoutState, form: FormData): Promise<CheckoutState> {
  const viewer = await requireViewer();
  if (!alipayReady()) return { error: "Alipay payments are being activated. Please check back shortly." };
  const plan = findPlan(form.get("plan"));
  const workspaceValue = form.get("workspaceId");
  const workspace = workspaceValue ? workspaceIdSchema.safeParse(workspaceValue) : null;
  const name = workspaceNameSchema.safeParse(form.get("name"));
  if (!plan || (workspace && !workspace.success) || (!workspace && !name.success)) return { error: "Choose a plan and enter a valid workspace name." };
  const { data, error } = await createSupabaseControl().rpc("create_subscription_order", {
    p_user_id: viewer.id, p_workspace_id: workspace?.success ? workspace.data : null,
    p_name: name.success ? name.data : "Workspace", p_plan_id: plan.id,
    p_out_trade_no: `FZ${randomUUID().replaceAll("-", "")}`,
  });
  if (error) {
    const safe = ["Verify your email before subscribing", "Workspace limit reached", "Renew the current plan, or change plans after it expires", "This plan cannot hold your current team", "Too many checkout attempts. Please try again later", "Finish the existing checkout or wait for it to expire before changing plans"];
    return { error: safe.includes(error.message) ? error.message : "Unable to start checkout. Please try again." };
  }
  const order = data as SubscriptionOrder;
  if (!workspaceIdSchema.safeParse(order?.id).success || !workspaceIdSchema.safeParse(order?.workspace_id).success) return { error: "Unable to start checkout. Please try again." };
  (await cookies()).set(workspaceCookie, order.workspace_id, workspaceCookieOptions());
  redirect(`/subscribe/orders/${order.id}`);
}
