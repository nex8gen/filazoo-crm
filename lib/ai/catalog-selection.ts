import { z } from "zod";
import { splitQuotedEmail } from "../email-content.ts";
import { allQuotationProductsRequested, matchQuotationProducts } from "./quotation-selection.ts";

export const catalogScopeSchema = z.enum(["selected", "all", "unavailable"]);
type CatalogProduct = { sku: string; name: string; material?: string | null; status?: string };
type CatalogSelection = { scope?: z.infer<typeof catalogScopeSchema>; productSkus: string[] };
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const catalogSelectionInstruction = [
  "Choose the catalog scope explicitly: selected for specific products or a material family, all only for an unrestricted full catalog, unavailable when no matching products can be verified.",
  "For selected, return every relevant exact top-level product SKU and no unrelated products. Never leave the selection empty to request a default or saved catalog.",
  "When specific types are named, include only those matching types. Standard PLA may match Basic PLA; do not assume PLA+ means PLA Pro or that ordinary PLA is high-speed unless the supplied records confirm it. Explain unavailable or uncertain types briefly and ask only the clarification needed.",
  "When the customer is unsure which PLA to choose, asks to compare PLA types, or wants all PLA options, include the available PLA family only. Never expand this to PETG, ABS, TPU or the whole store. Multiple requested material families may be included together.",
  "A catalog or product comparison does not require exact quantities, an address or an order commitment. Answer the product question first and describe the attachment's actual scope. Do not push for an invoice before the customer is ready to order.",
].join(" ");

/** Current customer evidence only; outbound offers and quoted mail never broaden scope. */
export function catalogRequestText(history: readonly { direction: string; body?: string | null }[]) {
  return [...history].reverse().filter(message => message.direction === "inbound" || message.direction === "received")
    .map(message => splitQuotedEmail(message.body || "").current).find(text => text.trim()) || "";
}

/** Validate before rendering. An omitted/empty selection must never mean the entire store. */
export function selectCatalogProducts<T extends CatalogProduct>(selection: CatalogSelection, products: readonly T[], requestText = ""): T[] {
  if (!selection.scope) throw new Error("AI did not specify the catalog scope. Retry the reply or select products manually.");
  if (selection.scope === "unavailable") {
    if (selection.productSkus.length) throw new Error("AI returned a conflicting catalog selection.");
    return [];
  }
  const active = products.filter(product => !product.status || product.status === "Active");
  const requested = new Set(selection.productSkus);
  if (selection.scope === "all" ? requested.size > 0 : !requested.size)
    throw new Error("AI returned an empty or conflicting catalog selection. Select the requested products before attaching a PDF.");
  if ([...requested].some(sku => !active.some(product => product.sku === sku))) throw new Error("AI selected unavailable catalog products.");
  const selected = selection.scope === "all" ? active : active.filter(product => requested.has(product.sku));
  if (!selected.length) throw new Error("No matching active catalog products are available.");

  const text = requestText.replace(/\bstandard\s+PLA\b/gi, "Basic PLA");
  const match = matchQuotationProducts(text, active);
  const unrestricted = allQuotationProductsRequested([{ role: "user", content: text }])
    && !match.excludedSkus.length && !match.excludedTerms.length;
  const family = (product: CatalogProduct) => (product.material || product.sku).toUpperCase().split(/[-\s]/)[0];
  const families = [...new Set(active.map(family).filter(Boolean))];
  const mentioned = families.filter(value => new RegExp(`\\b${escapePattern(value)}\\b`, "i").test(text)
    && active.some(product => family(product) === value && !match.excludedSkus.includes(product.sku)));
  if (!unrestricted && (mentioned.length || match.productSkus.length || match.ambiguous.length || match.excludedSkus.length)) {
    if (selection.scope === "all") throw new Error("The customer requested specific products. A full catalog cannot be attached.");
    const matched = active.filter(product => match.productSkus.includes(product.sku));
    if (selected.some(product => match.excludedSkus.includes(product.sku)
      || (mentioned.length > 0 && !mentioned.includes(family(product)))))
      throw new Error("The catalog contains products outside the customer's request.");
    // If exact types were recognized, do not fill that family with other types.
    // A bare family inquiry remains broad so customers can compare its options.
    for (const value of mentioned) {
      const exact = matched.filter(product => family(product) === value);
      const term = escapePattern(value);
      const exploringFamily = new RegExp(`\\b(?:all|every|other|different|various|many)\\s+${term}\\b|\\b${term}\\s+(?:options|types|range|variants)\\b`, "i").test(text);
      const hasSpecificType = exact.some(product => !new RegExp(`^${term}(?:[- ]BASIC)?$`, "i").test(product.sku))
        || new RegExp(`\\b(?:basic\\s+${term}|${term}\\s+basic)\\b`, "i").test(text);
      if (!exploringFamily && !exact.length && match.ambiguous.some(item => item.term.startsWith(`${value} `) && !item.options.length)
        && selected.some(product => family(product) === value))
        throw new Error("The requested product type is unavailable. Clarify it before attaching a substitute.");
      if (!exploringFamily && hasSpecificType && selected.some(product => family(product) === value && !exact.some(item => item.sku === product.sku)))
        throw new Error("The catalog contains types the customer did not request.");
    }
  }
  return selected;
}
