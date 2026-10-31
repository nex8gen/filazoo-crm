import { requireWorkspaceMember } from "@/lib/auth";
import { deleteFlow, updateFlow } from "@/lib/data/flows";
import { flowInputSchema } from "@/lib/flows";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await context.params;
  const parsed = flowInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid workflow." }, { status: 400 });
  try {
    return Response.json({ ok: true, flow: await updateFlow(viewer.id, id, parsed.data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update workflow.";
    return Response.json({ ok: false, error: message }, { status: message === "Workflow not found." ? 404 : 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await context.params;
  try {
    await deleteFlow(viewer.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete workflow.";
    return Response.json({ ok: false, error: message }, { status: message === "Workflow not found." ? 404 : 500 });
  }
}
