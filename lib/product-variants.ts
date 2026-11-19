import type { ProductVariant } from "./types.ts";
import { parseCurrencyAmount } from "./product-utils.ts";
import { validVariantPrice } from "./product-pricing.ts";

const colorNames: [string, string][] = [
  ["sky blue", "#69b8d8"], ["dark gold", "#986d24"], ["bright gold", "#dfa72b"], ["rose red", "#d94a79"],
  ["copper", "#b85237"], ["bronze", "#a57a3b"], ["silver", "#bfc5c9"], ["gold", "#cba02f"],
  ["black", "#171a1d"], ["white", "#f5f3eb"], ["yellow", "#f3cf37"], ["purple", "#9255a3"],
  ["green", "#2c8c62"], ["red", "#ce3b40"], ["pink", "#e88eaf"], ["blue", "#2c72b5"],
  ["orange", "#e78c32"], ["brown", "#8b5e3c"], ["gray", "#8d959e"], ["grey", "#8d959e"],
];

export function variantSwatch(variant: Pick<ProductVariant, "name" | "colorHex">) {
  if (variant.colorHex) return variant.colorHex;
  const name = variant.name.toLowerCase().replace(/[-_]/g, " ");
  return colorNames.find(([color]) => name.includes(color))?.[1] ?? null;
}

export function newProductVariant(sku: string, variants: ProductVariant[], price: string): ProductVariant {
  const prefix = sku.trim() || "NEW";
  const existing = new Set(variants.map(variant => variant.sku.toUpperCase()));
  let number = variants.length + 1;
  while (existing.has(`${prefix}-${String(number).padStart(2, "0")}`.toUpperCase())) number++;
  return { id: crypto.randomUUID(), name: "", sku: `${prefix}-${String(number).padStart(2, "0")}`, price, stockStatus: "Stock unknown", manualInventory: null, imageUrl: null };
}

export function variantSettingsError(variant: ProductVariant) {
  if (!validVariantPrice(variant.price)) return "Enter a valid selling price.";
  if (variant.compareAtPrice && !validVariantPrice(variant.compareAtPrice)) return "Enter a valid compare-at price.";
  if (variant.costPerItem && !validVariantPrice(variant.costPerItem)) return "Enter a valid cost per item.";
  if (variant.barcode && variant.barcode.length > 100) return "The barcode must be 100 characters or fewer.";
  const unit = variant.unitPricing;
  if (unit && (![unit.quantity, unit.referenceQuantity].every(value => Number.isFinite(value) && value >= 0.000001 && value <= 1_000_000) || !["g", "kg", "ml", "l", "cm", "m", "item"].includes(unit.unit))) return "Enter valid package and reference quantities for unit pricing.";
  return null;
}

export function variantOptionGroups(variants: ProductVariant[]) {
  const first = variants.find(variant => variant.options?.length)?.options;
  return first ? first.map(option => ({ name: option.name, values: [...new Set(variants.flatMap(variant => variant.options?.filter(item => item.name === option.name).map(item => item.value) ?? []))] })) : [{ name: "Color", values: [...new Set(variants.map(variant => variant.name))] }];
}

export function variantOptionsError(variants: ProductVariant[]) {
  if (!variants.some(variant => variant.options?.length)) return null;
  const names = variants[0]?.options?.map(option => option.name.trim().toLowerCase());
  if (!names?.length || names.length > 3 || new Set(names).size !== names.length) return "Use up to three different option names.";
  const combinations = new Set<string>();
  for (const variant of variants) {
    if (variant.options?.length !== names.length || variant.options.some((option, index) => option.name.trim().toLowerCase() !== names[index] || !option.value.trim() || option.value.length > 120 || option.name.length > 50)) return "Every variant needs a value for each product option.";
    if (variant.name.length > 400) return "The combined variant name is too long.";
    const key = JSON.stringify(variant.options.map(option => option.value.trim().toLowerCase()));
    if (combinations.has(key)) return "Each variant needs a different option combination.";
    combinations.add(key);
  }
  return null;
}

/** Assign the first new value to existing SKUs; generate additional combinations with new identities. */
export function addVariantOption(variants: ProductVariant[], name: string, values: string[], sku: string): ProductVariant[] {
  name = name.trim();
  values = [...new Map(values.map(value => [value.trim().toLowerCase(), value.trim()])).values()].filter(Boolean);
  const groups = variantOptionGroups(variants);
  if (!name || name.length > 50 || !values.length || values.some(value => value.length > 120)) throw new Error("Enter an option name and values (up to 120 characters each).");
  if (groups.length >= 3 || groups.some(group => group.name.toLowerCase() === name.toLowerCase())) throw new Error("Use up to three different product options.");
  if (variants.length * values.length > 100) throw new Error("These options would create more than 100 variants. Use fewer values.");
  const result: ProductVariant[] = [];
  for (const variant of variants) for (const [index, value] of values.entries()) {
    const options = [...(variant.options ?? [{ name: "Color", value: variant.name }]), { name, value }];
    const identity = index === 0 ? variant : newProductVariant(sku, [...variants, ...result], variant.price);
    result.push({ ...variant, ...identity, options, name: options.map(option => option.value).join(" / "), ...(index === 0 ? {} : { stock: undefined, manualInventory: null, sharedInventory: variant.sharedInventory ? { locations: [] } : undefined, barcode: null }) });
  }
  const error = variantOptionsError(result);
  if (error) throw new Error(error);
  return result;
}

export type ProductOptionValueEdit = { originalValue: string | null; value: string };

const optionKey = (value: string) => value.trim().toLowerCase();
const variantOptions = (variant: ProductVariant) => variant.options ?? [{ name: "Color", value: variant.name }];

/** Value renames retain their original SKU. Only newly added values receive new identities. */
export function updateVariantOption(variants: ProductVariant[], originalName: string, name: string, edits: ProductOptionValueEdit[], sku: string): ProductVariant[] {
  const groups = variantOptionGroups(variants);
  const index = groups.findIndex(group => optionKey(group.name) === optionKey(originalName));
  if (index < 0) throw new Error("This option no longer exists. Close the editor and try again.");
  name = name.trim();
  edits = edits.map(edit => ({ ...edit, value: edit.value.trim() }));
  if (!name || name.length > 50 || !edits.length || edits.some(edit => !edit.value || edit.value.length > 120)) throw new Error("Enter an option name and at least one value (up to 120 characters each).");
  if (groups.some((group, position) => position !== index && optionKey(group.name) === optionKey(name))) throw new Error("Each product option needs a different name.");
  if (new Set(edits.map(edit => optionKey(edit.value))).size !== edits.length) throw new Error("Each option value must be different.");
  const originals = edits.flatMap(edit => edit.originalValue === null ? [] : [optionKey(edit.originalValue)]);
  if (new Set(originals).size !== originals.length || originals.some(value => !groups[index].values.some(original => optionKey(original) === value))) throw new Error("An option value changed while you were editing. Reopen the option and try again.");
  const retained = new Map(edits.filter(edit => edit.originalValue !== null).map(edit => [optionKey(edit.originalValue!), edit.value]));
  const result: ProductVariant[] = [];
  const templates = new Map<string, ProductVariant>();
  for (const variant of variants) {
    const options = variantOptions(variant);
    const key = JSON.stringify(options.filter((_, position) => position !== index).map(option => optionKey(option.value)));
    const template = templates.get(key);
    if (!template || (!retained.has(optionKey(variantOptions(template)[index].value)) && retained.has(optionKey(options[index].value)))) templates.set(key, variant);
    const value = retained.get(optionKey(options[index].value));
    if (value === undefined) continue;
    const updated = options.map((option, position) => position === index ? { name, value } : { ...option });
    result.push({ ...variant, options: updated, name: updated.map(option => option.value).join(" / ") });
  }
  const added = edits.filter(edit => edit.originalValue === null);
  if (result.length + templates.size * added.length > 100) throw new Error("These options would create more than 100 variants. Use fewer values.");
  for (const template of templates.values()) for (const edit of added) {
    const options = variantOptions(template).map((option, position) => position === index ? { name, value: edit.value } : { ...option });
    const changesColor = optionKey(originalName) === "color" || optionKey(name) === "color";
    result.push({ ...newProductVariant(sku, [...variants, ...result], template.price), imageUrl: changesColor ? null : template.imageUrl, colorHex: changesColor ? null : template.colorHex, options, name: options.map(option => option.value).join(" / "), ...(template.sharedInventory ? { sharedInventory: { locations: [] } } : {}) });
  }
  const order = new Map(edits.map((edit, position) => [optionKey(edit.value), position]));
  result.sort((a, b) => order.get(optionKey(a.options![index].value))! - order.get(optionKey(b.options![index].value))!);
  const error = variantOptionsError(result);
  if (error) throw new Error(error);
  return result;
}

/** Removing a dimension explicitly retains one value; inventory from other SKUs is never merged. */
export function removeVariantOption(variants: ProductVariant[], name: string, keepValue: string): ProductVariant[] {
  const groups = variantOptionGroups(variants);
  if (groups.length < 2) throw new Error("Keep at least one product option.");
  const index = groups.findIndex(group => optionKey(group.name) === optionKey(name));
  if (index < 0 || !groups[index].values.some(value => optionKey(value) === optionKey(keepValue))) throw new Error("Choose which option value to keep.");
  const result = variants.filter(variant => optionKey(variantOptions(variant)[index].value) === optionKey(keepValue)).map(variant => {
    const options = variantOptions(variant).filter((_, position) => position !== index).map(option => ({ ...option }));
    return { ...variant, options, name: options.map(option => option.value).join(" / ") };
  });
  const error = variantOptionsError(result);
  if (error) throw new Error(error);
  return result;
}

export function reorderVariantOptions(variants: ProductVariant[], names: string[]): ProductVariant[] {
  const groups = variantOptionGroups(variants);
  if (names.length !== groups.length || new Set(names.map(optionKey)).size !== names.length || names.some(name => !groups.some(group => optionKey(group.name) === optionKey(name)))) throw new Error("Keep the same product options when changing their order.");
  return variants.map(variant => {
    const options = names.map(name => ({ ...variantOptions(variant).find(option => optionKey(option.name) === optionKey(name))! }));
    return { ...variant, options, name: options.map(option => option.value).join(" / ") };
  });
}

export function variantPriceSummary(variant: ProductVariant) {
  const price = parseCurrencyAmount(variant.price);
  const cost = variant.costPerItem ? parseCurrencyAmount(variant.costPerItem) : null;
  const profit = cost === null ? null : price - cost;
  const margin = profit === null || price === 0 ? null : profit / price * 100;
  const unit = variant.unitPricing;
  const unitPrice = unit && unit.quantity > 0 ? price / unit.quantity * unit.referenceQuantity : null;
  return { profit, margin, unitPrice: unitPrice !== null && Number.isFinite(unitPrice) ? unitPrice : null };
}
