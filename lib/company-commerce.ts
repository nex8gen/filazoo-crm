import { z } from "zod";
import { invoiceCurrencies } from "./invoices.ts";

export const commerceSchema = z.object({
  phone: z.string().trim().max(80),
  shippingRecipient: z.string().trim().max(160),
  shippingPhone: z.string().trim().max(80),
  shippingAddress: z.string().trim().max(2000),
  shippingNotes: z.string().trim().max(2000),
  address: z.string().trim().max(2000),
  taxId: z.string().trim().max(100),
  email: z.union([z.email(), z.literal("")]),
  currency: z.enum(invoiceCurrencies),
  termsDays: z.coerce.number().int().min(0).max(365),
});
export type CompanyCommerce = z.infer<typeof commerceSchema>;
export function commerceDefaults(
  profile?: Partial<CompanyCommerce> | null,
): CompanyCommerce {
  return {
    phone: "",
    shippingRecipient: "",
    shippingPhone: "",
    shippingAddress: "",
    shippingNotes: "",
    address: "",
    taxId: "",
    email: "",
    currency: "USD",
    termsDays: 0,
    ...profile,
  };
}
