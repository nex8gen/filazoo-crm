import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWorkspaceViewer } from "@/lib/auth";
import { QuotationError, quotationDetail, mutateQuotation } from "@/lib/data/quotations";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof QuotationError ? error.message : "Unable to load or save this quotation. Please retry." }, { status: error instanceof QuotationError ? error.status : 503, headers });
}
export async function GET(_request: Request, context: Context) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  try { return Response.json(await quotationDetail((await context.params).id, viewer), { headers }); } catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid quotation ID." }, { status: 400, headers });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "Invalid quotation request." }, { status: 400, headers }); }
  try {
    const result = await mutateQuotation(id, input, viewer);
    const detail = await quotationDetail(id, viewer);
    revalidatePath("/company-quotations"); revalidatePath(`/company-quotations/${id}`); revalidatePath(`/companies/${detail.catalog.company_id}`); revalidatePath("/my-day");
    return Response.json({ ...result, detail }, { headers });
  } catch (error) { return failure(error); }
}
