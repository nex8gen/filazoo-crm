type MetaOrderLead = { created_at: string; field_data: unknown };

const orderFields = new Set([
  "what_is_your_expected_initial_order_quantity?",
  "expected_order_quantity",
  "order_quantity",
]);

/** Keep the customer's range and qualifiers instead of presenting a bound as an exact order. */
export function metaOrderLabel(leads: MetaOrderLead[], quantity: number | null): string | null {
  for (const lead of [...leads].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    if (!Array.isArray(lead.field_data)) continue;
    for (const field of lead.field_data) {
      if (!field || typeof field.name !== "string" || !orderFields.has(field.name.toLowerCase())) continue;
      const answer = Array.isArray(field.values) ? field.values[0] : null;
      if (typeof answer !== "string" || !answer.trim() || /test lead|dummy data/i.test(answer)) continue;
      const label = answer.trim().replaceAll("_", " ").replace(/\s+/g, " ");
      const bound = label.replaceAll(",", "").match(/\d+(?:\.\d+)?/);
      // A different pipeline quantity is an operator's override, so keep it visible.
      if (quantity !== null && (!bound || Math.round(Number(bound[0])) !== quantity)) return null;
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
  }
  return null;
}
