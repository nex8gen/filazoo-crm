import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { flowEditorSaveSchema } from "@/lib/flow-editor-draft";
import { saveFlowEditingCopy } from "@/lib/data/flow-editor-draft";

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > 750000) return Response.json({ ok: false, error: "Workflow changes are too large." }, { status: 413 });
  let value: unknown;
  try { value = JSON.parse(body); } catch { return Response.json({ ok: false, error: "Invalid workflow changes." }, { status: 400 }); }
  const parsed = flowEditorSaveSchema.safeParse(value);
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Invalid workflow changes." }, { status: 400 });
  try {
    const flow = await withWorkspaceViewer(viewer, () => saveFlowEditingCopy(viewer, parsed.data));
    return Response.json({ ok: true, flow }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Unable to save workflow changes automatically.";
    return Response.json({ ok: false, error }, { status: error.includes("Reload before saving") ? 409 : error === "Workflow not found." ? 404 : 500 });
  }
}
