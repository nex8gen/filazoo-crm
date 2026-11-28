import "server-only";
import { createSupabaseControl } from "../supabase/control.ts";
import { workspaceIdSchema } from "../workspaces.ts";
import { maxRechargeCredits, parseEcbUsdCny, type RechargePricing } from "./recharge.ts";

export async function getRechargePricing(): Promise<RechargePricing> {
  // Only the public rate feed is cached. No workspace or user data enters it.
  const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
    next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (!response.ok) throw new Error("Pricing is temporarily unavailable.");
  const rate = parseEcbUsdCny(await response.text());
  const { data, error } = await createSupabaseControl().rpc("prepare_credit_recharge_pricing", {
    p_base_rate_micros: rate.baseRateMicros, p_source_date: rate.sourceDate,
  });
  if (error || !data || !workspaceIdSchema.safeParse(data.id).success || !maxRechargeCredits(data.rateMicros)
    || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) throw new Error("Pricing is temporarily unavailable.");
  return { id: data.id, rateMicros: data.rateMicros, expiresAt: data.expiresAt };
}
