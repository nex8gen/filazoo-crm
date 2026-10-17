import { requireWorkspaceMember } from "@/lib/auth";
import { createFlow, listFlows } from "@/lib/data/flows";
import { flowInputSchema } from "@/lib/flows";

export async function GET() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  try {
    return Response.json({ ok: true, flows: await listFlows(viewer.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load flows." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator"]);
  const parsed = flowInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid flow." }, { status: 400 });
  try {
    return Response.json({ ok: true, flow: await createFlow(viewer.id, parsed.data) }, { status: 201 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to create flow." }, { status: 500 });
  }
}
