import { z } from "zod";

export type FlowCustomer = { id: string; name: string | null; email: string; companyId: string; companyName: string };
export type FlowCompany = { id: string; name: string };

export const flowCustomerQuerySchema = z.object({
  kind: z.enum(["companies", "customers", "preview"]).default("customers"),
  query: z.string().trim().max(120).default(""),
  companyId: z.uuid().optional(),
  ids: z.array(z.uuid()).min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).refine((input) => input.kind !== "customers" || input.companyId || input.ids, { message: "Choose a company." });
