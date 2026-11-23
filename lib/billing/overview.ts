import "server-only";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import type { BillingOverview } from "./credits.ts";

export async function billingOverview(viewer: WorkspaceViewer): Promise<BillingOverview> {
  if (viewer.role !== "admin") throw new Error("Administrator access required.");
  return withWorkspaceViewer(viewer, async () => {
    const { data, error } = await createSupabaseAdmin().rpc("read_billing_overview", { p_actor_id: viewer.id });
    if (error || !data) throw new Error("Plan and credit usage are temporarily unavailable. Please try again.");
    // Billing screens receive customer-facing plan totals only.
    return { plan: data.plan, seats: data.seats, grandfathered: data.grandfathered, active: data.active,
      complimentary: data.complimentary, creditOnly: data.creditOnly, memberCount: data.memberCount, credits: data.credits,
      limits: data.limits ?? {}, usage: data.usage } as BillingOverview;
  });
}
