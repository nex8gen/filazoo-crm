/** One credit represents 1,000 ledger microdollars. Fractional credits are retained. */
export const MICROS_PER_CREDIT = 1000;
export function formatCredits(micros: number) {
  return (micros / MICROS_PER_CREDIT).toLocaleString("en-US", { maximumFractionDigits: 3 });
}
/** Keep fractional usage accurate; rounding up made tiny requests look like 1%. */
export function usagePercent(used: number, limit: number | null | undefined) {
  if (limit == null || !Number.isFinite(limit)) return null;
  if (limit <= 0) return 100;
  return Math.max(0, Math.min(100, Math.max(0, used) / limit * 100));
}
export function formatUsagePercent(percent: number) {
  return percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
export type CreditBalance = {
  includedMicros: number; topupMicros: number; usedMicros: number; remainingMicros: number;
  resetsAt: string; percent: number;
};
export type BillingOverview = {
  plan: string; seats: number; memberCount?: number; grandfathered: boolean; active: boolean; complimentary?: boolean; creditOnly?: boolean;
  credits: CreditBalance;
  limits: Record<"companies" | "products" | "mailboxes" | "flows" | "flowRuns" | "documentBytes", number | null>;
  usage: Record<"companies" | "products" | "mailboxes" | "flows" | "flowRuns" | "documentBytes", number>;
};
