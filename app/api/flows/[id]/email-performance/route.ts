import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { getEmailPerformance } from "@/lib/data/flow-email-performance";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id } = await context.params;
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return Response.json({ ok: false, error: "Choose a valid workflow." }, { status: 400 });
  try {
    const report = await withWorkspaceViewer(viewer, () => getEmailPerformance(id));
    return Response.json({ ok: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Unable to load email performance.";
    return Response.json({ ok: false, error }, { status: error === "Workflow not found." ? 404 : error === "Access denied." ? 403 : 500 });
  }
}
