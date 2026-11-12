import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { createQuotationDraft, QuotationError } from "@/lib/data/quotations";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to your workspace." }, { status: 401, headers });
  if (viewer.role === "viewer" || request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Your session cannot create quotations." }, { status: 403, headers });
  const input = z.object({ companyId: z.uuid(), productSkus: z.array(z.string().min(1).max(200)).min(1).max(100), currency: z.enum(["USD", "EUR", "GBP", "CNY", "CAD", "AUD", "HKD"]) }).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Choose a customer, products and currency." }, { status: 400, headers });
  try {
    const result = await withWorkspaceViewer(viewer, () => createQuotationDraft(input.data, viewer, crypto.randomUUID()));
    return Response.json({ ...result, href: `/company-quotations/${result.id}` }, { headers });
  } catch (error) { return Response.json({ error: error instanceof QuotationError ? error.message : "Unable to create the quotation. Try again." }, { status: error instanceof QuotationError ? error.status : 503, headers }); }
}
