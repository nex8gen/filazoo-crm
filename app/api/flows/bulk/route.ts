import { requireWorkspaceMember } from "@/lib/auth";
import { bulkUpdateFlows } from "@/lib/data/flows";
import { flowBulkInputSchema } from "@/lib/flows";

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const parsed = flowBulkInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid bulk action." }, { status: 400 });
  try {
    const results = await bulkUpdateFlows(viewer.id, parsed.data.ids, parsed.data.action);
    return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to update workflows." }, { status: 500 });
  }
}
