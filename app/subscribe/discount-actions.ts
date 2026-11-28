"use server";

import { createHash } from "node:crypto";
import { requireViewer } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { workspaceIdSchema } from "@/lib/workspaces";

export async function applyCreditDiscount(workspaceId: string, code: string): Promise<{ discountPercent?: number; error?: string }> {
  const viewer = await requireViewer();
  if (!workspaceIdSchema.safeParse(workspaceId).success || typeof code !== "string" || !/^[A-Z0-9-]{6,80}$/.test(code.trim().toUpperCase())) return { error: "Enter a valid discount code." };
  const { data, error } = await createSupabaseControl().rpc("check_credit_discount", {
    p_user_id: viewer.id, p_workspace_id: workspaceId,
    p_code_hash: createHash("sha256").update(code.trim().toUpperCase()).digest("hex"),
  });
  if (error || data?.discountPercent !== 100) return { error: "This discount code is not available for your account." };
  return { discountPercent: 100 };
}

export async function applySubscriptionDiscount(workspaceId: string | undefined, code: string): Promise<{ discountPercent?: number; error?: string }> {
  const viewer = await requireViewer();
  if ((workspaceId !== undefined && !workspaceIdSchema.safeParse(workspaceId).success) || typeof code !== "string" || !/^[A-Z0-9-]{6,80}$/.test(code.trim().toUpperCase())) return { error: "Enter a valid discount code." };
  const { data, error } = await createSupabaseControl().rpc("check_subscription_discount", {
    p_user_id: viewer.id, p_workspace_id: workspaceId ?? null,
    p_code_hash: createHash("sha256").update(code.trim().toUpperCase()).digest("hex"),
  });
  if (error || data?.discountPercent !== 100) return { error: "This code is invalid, expired, already used, or unavailable for your account." };
  return { discountPercent: 100 };
}
