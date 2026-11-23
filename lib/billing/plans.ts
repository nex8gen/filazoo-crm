/** Frozen v2/v3 per-seat catalog for existing orders and renewals. */
export const seatPlans = [
  { id: "starter", name: "Starter", amountFen: 13900, amountCents: 1900, credits: 2000, companies: 1000, products: 500, mailboxes: 1, flows: 3, flowRuns: 1000, documentBytes: 1_000_000_000, description: "Everyday CRM, email, documents and AI assistance." },
  { id: "pro", name: "Pro", amountFen: 27900, amountCents: 3900, credits: 5000, companies: 10000, products: 5000, mailboxes: 3, flows: 20, flowRuns: 10000, documentBytes: 5_000_000_000, description: "More customers, connected inboxes and automated follow-ups." },
  { id: "business", name: "Business", amountFen: 55900, amountCents: 7900, credits: 12000, companies: 50000, products: 25000, mailboxes: 5, flows: 100, flowRuns: 50000, documentBytes: 20_000_000_000, description: "Larger teams, catalogs and automation workloads." },
] as const;
/** Catalog v4: prices, credits and capacity apply once per workspace package. */
export const plans = [
  { ...seatPlans[0], members: 1, amountFen: 13900, amountCents: 1900, annualMonthlyFen: 10900, annualMonthlyCents: 1500, credits: 2000 },
  { ...seatPlans[1], members: 2, amountFen: 42900, amountCents: 5900, annualMonthlyFen: 35900, annualMonthlyCents: 4900, credits: 6000 },
  { ...seatPlans[2], members: 5, amountFen: 92900, amountCents: 12900, annualMonthlyFen: 77900, annualMonthlyCents: 10900, credits: 15000 },
] as const;
export type PlanId = typeof plans[number]["id"];
export type BillingPeriod = "monthly" | "annual";
/** Annual prices show a monthly equivalent; checkout collects twelve months. */
export function planPrice(plan: typeof plans[number], period: BillingPeriod) {
  const months = period === "annual" ? 12 : 1;
  const monthlyFen = period === "annual" ? plan.annualMonthlyFen : plan.amountFen;
  const monthlyCents = period === "annual" ? plan.annualMonthlyCents : plan.amountCents;
  return { monthlyFen, monthlyCents, amountFen: monthlyFen * months, amountCents: monthlyCents * months,
    savingsFen: (plan.amountFen - plan.annualMonthlyFen) * 12 };
}
export function findPlan(id: unknown) { return plans.find(plan => plan.id === id); }
export const legacyPlans = [
  { id: "starter", name: "Starter (legacy)", amountFen: 9900, members: 1 },
  { id: "team", name: "Team (legacy)", amountFen: 29900, members: 5 },
] as const;
export const creditPacks = [{ id: "credits_3000", name: "3,000 AI credits", credits: 3000, amountFen: 6900, amountCents: 1000 }] as const;
export function orderProduct(order: Pick<SubscriptionOrder, "plan_id" | "catalog_version" | "kind" | "seats" | "period_months">) {
  if (order.period_months !== undefined && order.period_months !== 1 && order.period_months !== 12) return undefined;
  if ((order.catalog_version ?? 1) < 3 && (order.period_months ?? 1) !== 1) return undefined;
  if ((order.catalog_version ?? 1) === 1) return legacyPlans.find(plan => plan.id === order.plan_id);
  if (order.catalog_version === 4) {
    const plan = findPlan(order.plan_id);
    if (!plan || order.kind !== "subscription" || order.seats !== plan.members) return undefined;
    return { ...plan, ...planPrice(plan, order.period_months === 12 ? "annual" : "monthly") };
  }
  if (order.catalog_version !== 2 && order.catalog_version !== 3) return undefined;
  if (order.catalog_version === 3 && order.kind === "credits") return undefined;
  if (order.kind === "credits") return (order.seats ?? 1) === 1 ? creditPacks.find(pack => pack.id === order.plan_id) : undefined;
  const plan = seatPlans.find(value => value.id === order.plan_id);
  const seats = order.seats ?? 1;
  if (!plan || !Number.isInteger(seats) || seats < 1 || seats > 100) return undefined;
  return order.catalog_version === 3 ? { ...plan, amountFen: plan.amountFen * seats * (order.period_months === 12 ? 12 : 6 / 5), amountCents: plan.amountCents * seats * (order.period_months === 12 ? 12 : 6 / 5) }
    : { ...plan, amountFen: plan.amountFen * seats, amountCents: plan.amountCents * seats };
}
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
  plan_id: PlanId | "team" | "credits_3000"; amount_fen: number; currency: "CNY";
  catalog_version?: number; kind?: "subscription" | "credits"; seats?: number;
  period_months?: number;
  status: "pending" | "paid" | "closed" | "refunded";
  expires_at: string; created_at: string; paid_at: string | null;
  period_start: string | null; period_end: string | null; alipay_trade_no: string | null;
};
