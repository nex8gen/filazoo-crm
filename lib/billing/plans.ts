export const plans = [
  { id: "starter", name: "Starter", amountFen: 9900, members: 1, description: "Your own workspace for customers, conversations, and follow-ups." },
  { id: "team", name: "Team", amountFen: 29900, members: 5, description: "A shared workspace for a growing sales team." },
] as const;
export type PlanId = typeof plans[number]["id"];
export function findPlan(id: unknown) { return plans.find(plan => plan.id === id); }
export function yuan(fen: number) { return (fen / 100).toFixed(2); }
/** Parse money without floating-point rounding, exponents, or permissive parseFloat. */
export function amountFen(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}
export type SubscriptionOrder = {
  id: string; workspace_id: string; user_id: string; out_trade_no: string;
  plan_id: PlanId; amount_fen: number; currency: "CNY";
  status: "pending" | "paid" | "closed" | "refunded";
  expires_at: string; created_at: string; paid_at: string | null;
  period_start: string | null; period_end: string | null; alipay_trade_no: string | null;
};
