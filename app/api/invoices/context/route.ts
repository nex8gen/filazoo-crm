import { z } from "zod";
import { invoiceAccess, invoiceError } from "@/lib/invoice-api";
import {
  customerBilling,
  invoiceBootstrap,
  invoiceCustomers,
  invoiceProducts,
} from "@/lib/data/invoice-connections";
import { invoiceCurrencies } from "@/lib/invoices";
import { invoiceBankAccounts } from "@/lib/data/invoice-banks";

const querySchema = z.object({
  kind: z
    .enum(["bootstrap", "customers", "products", "customer", "banks"])
    .default("bootstrap"),
  search: z.string().max(200).default(""),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  companyId: z.uuid().optional(),
  email: z.email().optional(),
  threadId: z.string().max(1000).optional(),
  currency: z.enum(invoiceCurrencies).optional(),
  skus: z.string().max(22000).optional(),
});
export async function GET(request: Request) {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  const input = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!input.success)
    return Response.json(
      { error: "Invalid invoice context." },
      { status: 400 },
    );
  const query = input.data;
  const skus = query.skus
    ? z
        .array(z.string().min(1).max(200))
        .min(1)
        .max(100)
        .safeParse(
          (() => {
            try {
              return JSON.parse(query.skus!);
            } catch {
              return null;
            }
          })(),
        )
    : undefined;
  if (skus && !skus.success)
    return Response.json(
      { error: "Invalid product selection." },
      { status: 400 },
    );
  try {
    if (query.kind === "banks")
      return Response.json({ accounts: await invoiceBankAccounts() }, { headers: { "Cache-Control": "no-store" } });
    const result =
      query.kind === "customers"
        ? await invoiceCustomers(query.search, query.page)
        : query.kind === "products"
          ? await invoiceProducts(
              query.search,
              query.page,
              query.currency,
              skus?.data,
            )
          : query.kind === "customer" && query.companyId
            ? await customerBilling(query.companyId)
            : await invoiceBootstrap(query);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invoiceError(error);
  }
}
