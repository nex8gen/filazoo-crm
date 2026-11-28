"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { alipayReady } from "@/lib/billing/alipay";
import { parseRechargeCredits, MAX_RECHARGE_AMOUNT_FEN } from "@/lib/billing/recharge";
import { createSupabaseControl } from "@/lib/supabase/control";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema } from "@/lib/workspaces";
import type { CheckoutState } from "./actions";

export type RechargeState = CheckoutState & { credits?: number; success?: boolean };

export async function startCreditRecharge(_state: RechargeState, form: FormData): Promise<RechargeState> {
  const viewer = await requireViewer();
  const workspace = workspaceIdSchema.safeParse(form.get("workspaceId"));
  const credits = parseRechargeCredits(form.get("credits"));
  if (!workspace.success || credits == null) return { error: "Enter a valid credit amount and refresh pricing." };
  const code = form.get("discountCode");
  if (typeof code === "string" && code.trim()) {
    const normalized = code.trim().toUpperCase();
    const request = workspaceIdSchema.safeParse(form.get("requestId"));
    if (!/^[A-Z0-9-]{6,80}$/.test(normalized)) return { error: "Enter a valid discount code." };
    if (!request.success || credits > Math.floor(Number.MAX_SAFE_INTEGER / 1000)) return { error: "Enter a valid credit amount." };
    const { data, error } = await createSupabaseControl().rpc("redeem_credit_discount", {
      p_user_id: viewer.id, p_workspace_id: workspace.data,
      p_code_hash: createHash("sha256").update(normalized).digest("hex"),
      p_credits: credits, p_request_id: request.data,
    });
    if (error || data?.workspaceId !== workspace.data || data?.credits !== credits) return { error: "Unable to recharge. Check your discount code and try again." };
    revalidatePath("/settings/credits");
    revalidatePath("/settings/profile");
    return { success: true, credits };
  }
  if (!alipayReady()) return { error: "Alipay payment is not available at this time." };
  const pricing = workspaceIdSchema.safeParse(form.get("pricingId"));
  const expected = form.get("expectedAmountFen");
  if (!workspace.success || !pricing.success || credits == null || typeof expected !== "string"
    || !/^[1-9]\d{0,9}$/.test(expected) || Number(expected) > MAX_RECHARGE_AMOUNT_FEN) return { error: "Enter a valid credit amount and refresh pricing." };
  const { data, error } = await createSupabaseControl().rpc("create_credit_recharge_order", {
    p_user_id: viewer.id, p_workspace_id: workspace.data, p_pricing_id: pricing.data,
    p_credits: credits, p_expected_amount_fen: Number(expected), p_out_trade_no: `FZ${randomUUID().replaceAll("-", "")}`,
  });
  if (error) {
    const safe = ["Only the workspace owner can recharge credits", "Verify your email before recharging", "An active subscription is required", "Refresh pricing before recharging", "Recharge total changed. Refresh pricing and try again", "Enter a valid credit amount", "This amount exceeds the per-payment limit. Split it into separate recharges", "Too many checkout attempts. Please try again later", "Finish the existing checkout or wait for it to expire before changing plans"];
    return { error: safe.includes(error.message) ? error.message : "Unable to start recharge. Please try again." };
  }
  if (!workspaceIdSchema.safeParse(data?.id).success || data?.workspace_id !== workspace.data) return { error: "Unable to start recharge. Please try again." };
  (await cookies()).set(workspaceCookie, data.workspace_id, workspaceCookieOptions());
  redirect(`/subscribe/orders/${data.id}`);
}
