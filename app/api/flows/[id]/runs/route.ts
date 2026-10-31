import { requireWorkspaceMember } from "@/lib/auth";
import { listFlowRunInsights } from "@/lib/data/flow-runtime";

export async function GET(_request: Request, context: RouteContext<"/api/flows/[id]/runs">) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id } = await context.params;
  try {
    return Response.json({ ok: true, runs: await listFlowRunInsights(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load workflow insights.";
    return Response.json({ ok: false, error: message }, { status: message === "Workflow not found." ? 404 : 500 });
  }
}
