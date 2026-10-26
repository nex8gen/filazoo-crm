import { z } from "zod";
import { loadPortalData, portalError, portalHeaders } from "@/lib/data/customer-portal";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid invoice." }, { status: 400, headers: portalHeaders });
    return Response.json(await loadPortalData(id), { headers: portalHeaders });
  } catch (error) { return portalError(error); }
}
