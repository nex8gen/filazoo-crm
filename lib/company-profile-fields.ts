import { z } from "zod";
import { commerceSchema } from "./company-commerce.ts";
import { invoiceCurrencies } from "./invoices.ts";
import { pipelineStageValues } from "./types.ts";

/** A patch validates only supplied fields; incomplete imported profiles remain editable. */
export const companyProfileChangesSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  website: z.string().trim().max(500).optional(),
  country: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().max(100).optional(),
  segment: z.string().trim().min(2).max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactRole: z.string().trim().max(120).optional(),
  contactEmail: z.email().optional(),
  stage: z.enum(pipelineStageValues).optional(),
  summary: z.string().trim().max(5000).optional(),
  tags: z.string().trim().max(2000).optional(),
  fitScore: z.union([z.number().int().min(1).max(10), z.literal("")]).optional(),
  estimatedOrderQuantity: z.union([z.number().int().min(0).max(100_000_000), z.literal("")]).optional(),
  estimatedValue: z.union([z.number().min(0).max(1_000_000_000), z.literal("")]).optional(),
  currency: z.enum(invoiceCurrencies).optional(),
  nextFollowupAt: z.union([z.iso.datetime({ offset: true }), z.literal("")]).optional(),
  commerce: commerceSchema.partial().strict().optional(),
}).strict().refine((value) => Object.entries(value).some(([key, field]) => field !== undefined && (key !== "commerce" || Object.values(field ?? {}).some((value) => value !== undefined))), "Specify at least one field to update.");
export type CompanyProfileChanges = z.infer<typeof companyProfileChangesSchema>;

const normalizeCountry = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
let countryNames: Map<string, string> | undefined;
/** Recognize explicit country names/safe aliases at the end of an address; never guess from a US state. */
export function countryFromAddress(address: string) {
  if (!countryNames) {
    countryNames = new Map();
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second);
      const name = names.of(code);
      if (name && name !== code && !["EU", "UN", "ZZ", "GE", "JE"].includes(code)) countryNames.set(normalizeCountry(name), name);
    }
    for (const alias of ["usa", "u s a", "us", "u s", "united states of america"]) countryNames.set(alias, "United States");
    for (const alias of ["uk", "u k", "great britain"]) countryNames.set(alias, "United Kingdom");
    countryNames.set("uae", "United Arab Emirates");
    countryNames.set("pr china", "China");
    countryNames.set("south korea", "South Korea");
  }
  const ending = normalizeCountry(address.split(/[,;\n]/).filter((part) => part.trim()).at(-1) ?? "");
  return [...countryNames.entries()].sort((a, b) => b[0].length - a[0].length).find(([alias]) => ending === alias || (alias.length > 3 && ending.endsWith(` ${alias}`)))?.[1] ?? null;
}

/** Called only for an explicit derive-address proposal, before the approval card is created. */
export function deriveCompanyAddressFields(changes: CompanyProfileChanges, savedFields: Record<string, string>) {
  if (changes.country !== undefined || savedFields.country?.trim()) return changes;
  const country = countryFromAddress(changes.commerce?.shippingAddress || changes.commerce?.address || "");
  return country ? { ...changes, country } : changes;
}
