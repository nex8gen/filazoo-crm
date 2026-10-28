export type QuantityPrice = { minimumQuantity: number; price: string };

/** A break applies up to the quantity immediately before the next break. */
export function quantityRangeLabel(minimum: number, nextMinimum?: number) {
  return nextMinimum === undefined ? `${minimum}+ qty` : `${minimum} to ${nextMinimum - 1} qty`;
}

export function quantityPriceRanges(tiers: QuantityPrice[]) {
  const sorted = [...tiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  return sorted.map((tier, index) => ({ ...tier, label: quantityRangeLabel(tier.minimumQuantity, sorted[index + 1]?.minimumQuantity) }));
}

export function quantityPricingError(tiers: QuantityPrice[]) {
  if (!tiers.length || tiers.some((tier) => !Number.isSafeInteger(tier.minimumQuantity) || tier.minimumQuantity < 1)) {
    return "Enter a positive whole number for each quantity.";
  }
  if (tiers.some((tier, index) => index > 0 && tier.minimumQuantity <= tiers[index - 1].minimumQuantity)) {
    return "Each quantity range must start after the previous range.";
  }
  if (tiers.some((tier) => tier.price.trim() === "" || !Number.isFinite(Number(tier.price)) || Number(tier.price) < 0)) {
    return "Enter a valid unit price for each quantity range.";
  }
  return null;
}
