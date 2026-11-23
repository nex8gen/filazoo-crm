export const plans = [
  { id: "starter", name: "Starter", amountFen: 13900, amountCents: 1900, credits: 2000, companies: 1000, products: 500, mailboxes: 1, flows: 3, flowRuns: 1000, documentBytes: 1_000_000_000, description: "Everyday CRM, email, documents and AI assistance." },
  { id: "pro", name: "Pro", amountFen: 27900, amountCents: 3900, credits: 5000, companies: 10000, products: 5000, mailboxes: 3, flows: 20, flowRuns: 10000, documentBytes: 5_000_000_000, description: "More customers, connected inboxes and automated follow-ups." },
  { id: "business", name: "Business", amountFen: 55900, amountCents: 7900, credits: 12000, companies: 50000, products: 25000, mailboxes: 5, flows: 100, flowRuns: 50000, documentBytes: 20_000_000_000, description: "Larger teams, catalogs and automation workloads." },
] as const;
export type PlanId = typeof plans[number]["id"];
export function findPlan(id: unknown) { return plans.find(plan => plan.id === id); }
export const legacyPlans = [
  { id: "starter", name: "Starter (legacy)", amountFen: 9900, members: 1 },
  { id: "team", name: "Team (legacy)", amountFen: 29900, members: 5 },
] as const;
export const creditPacks = [{ id: "credits_3000", name: "3,000 AI credits", credits: 3000, amountFen: 6900, amountCents: 1000 }] as const;
export function orderProduct(order: Pick<SubscriptionOrder, "plan_id" | "catalog_version" | "kind" | "seats">) {
  if ((order.catalog_version ?? 1) === 1) return legacyPlans.find(plan => plan.id === order.plan_id);
  if (order.catalog_version !== 2) return undefined;
  if (order.kind === "credits") return (order.seats ?? 1) === 1 ? creditPacks.find(pack => pack.id === order.plan_id) : undefined;
  const plan = findPlan(order.plan_id);
  const seats = order.seats ?? 1;
  if (!plan || !Number.isInteger(seats) || seats < 1 || seats > 100) return undefined;
  return { ...plan, amountFen: plan.amountFen * seats, amountCents: plan.amountCents * seats };
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
  status: "pending" | "paid" | "closed" | "refunded";
  expires_at: string; created_at: string; paid_at: string | null;
  period_start: string | null; period_end: string | null; alipay_trade_no: string | null;
};
