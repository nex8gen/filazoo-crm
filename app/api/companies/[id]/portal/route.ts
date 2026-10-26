import { z } from "zod";
import { invoiceAccess, invoiceError } from "@/lib/invoice-api";
import { getCompanyPortal } from "@/lib/data/company-portal";
import { portalHeaders } from "@/lib/data/customer-portal";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  const query = z.object({ page: z.coerce.number().int().min(0).max(100000).default(0), invoiceId: z.uuid().optional() }).safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!z.uuid().safeParse(id).success || !query.success) return Response.json({ error: "Invalid customer portal request." }, { status: 400 });
  try {
    const data = await getCompanyPortal(id, query.data.page, query.data.invoiceId);
    return data ? Response.json(data, { headers: portalHeaders }) : Response.json({ error: "Customer profile not found." }, { status: 404 });
  } catch (error) { return invoiceError(error); }
}
