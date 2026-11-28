import { formatCredits, MICROS_PER_CREDIT } from "./credits.ts";

export type RechargePricing = { id: string; rateMicros: number; expiresAt: string };
// Existing Alipay order amounts are PostgreSQL integers, in fen. Recharges have
// no lifetime/workspace cap; each payment must fit the payment/order format.
export const MAX_RECHARGE_AMOUNT_FEN = 2_147_483_647;
const PRICE_DIVISOR = BigInt(10_000_000);

export function parseRechargeCredits(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,14}$/.test(value)) return null;
  const credits = Number(value);
  return Number.isSafeInteger(credits) ? credits : null;
}

export function rechargeAmountFen(credits: number, rateMicros: number): number | null {
  if (!Number.isSafeInteger(credits) || credits <= 0 || !Number.isSafeInteger(rateMicros) || rateMicros < 1_000_000 || rateMicros > 51_000_000) return null;
  const amount = (BigInt(credits) * BigInt(rateMicros) + PRICE_DIVISOR - BigInt(1)) / PRICE_DIVISOR;
  return amount > BigInt(MAX_RECHARGE_AMOUNT_FEN) ? null : Number(amount);
}

export function maxRechargeCredits(rateMicros: number) {
  return Number.isSafeInteger(rateMicros) && rateMicros >= 1_000_000 && rateMicros <= 51_000_000
    ? Number(BigInt(MAX_RECHARGE_AMOUNT_FEN) * PRICE_DIVISOR / BigInt(rateMicros)) : 0;
}

export function rechargeProduct(order: { credit_quantity?: number; credit_rate_micros?: number; seats?: number; period_months?: number; kind?: string; plan_id: string }) {
  if (order.kind !== "credits" || order.plan_id !== "credits_custom" || order.seats !== 1 || (order.period_months ?? 1) !== 1) return undefined;
  const amountFen = rechargeAmountFen(order.credit_quantity ?? 0, order.credit_rate_micros ?? 0);
  if (amountFen == null) return undefined;
  return { id: "credits_custom", name: `${formatCredits(order.credit_quantity! * MICROS_PER_CREDIT)} AI credits`, credits: order.credit_quantity!, amountFen };
}

export function parseEcbUsdCny(xml: string, now = Date.now()) {
  if (xml.length > 65_536) throw new Error("Pricing is temporarily unavailable.");
  const sourceDate = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const date = sourceDate ? Date.parse(`${sourceDate}T00:00:00Z`) : NaN;
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== sourceDate || date > now || now - date > 7 * 86_400_000) throw new Error("Pricing is temporarily unavailable.");
  const rates: Record<string, number> = {};
  for (const cube of xml.matchAll(/<Cube\b([^>]+)>/g)) {
    const currency = /\bcurrency=['"]([A-Z]{3})['"]/.exec(cube[1])?.[1];
    const rate = /\brate=['"](\d+(?:\.\d+)?)['"]/.exec(cube[1])?.[1];
    if (currency && rate) rates[currency] = Number(rate);
  }
  const baseRateMicros = Math.round(rates.CNY / rates.USD * 1_000_000);
  if (!Number.isSafeInteger(baseRateMicros) || baseRateMicros < 1_000_000 || baseRateMicros > 50_000_000) throw new Error("Pricing is temporarily unavailable.");
  return { sourceDate: sourceDate!, baseRateMicros };
}
