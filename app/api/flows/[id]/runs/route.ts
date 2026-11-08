import { requireWorkspaceMember } from "@/lib/auth";
import { listFlowRunInsights } from "@/lib/data/flow-runtime";

export async function GET(request: Request, context: RouteContext<"/api/flows/[id]/runs">) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const status = params.get("status") || "all";
  const selectedStatus = status === "active" || status === "done" || status === "cancelled" || status === "failed" ? status : undefined;
  const page = Number(params.get("page") || "0");
  if ((status !== "all" && !selectedStatus) || !Number.isSafeInteger(page) || page < 0 || page > 1000) return Response.json({ ok: false, error: "Choose a valid run status and page." }, { status: 400 });
  try {
    const runs = await listFlowRunInsights(id, { status: selectedStatus, page });
    return Response.json({ ok: true, runs: runs.slice(0, 25), hasMore: runs.length > 25 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load workflow insights.";
    return Response.json({ ok: false, error: message }, { status: message === "Workflow not found." ? 404 : 500 });
  }
}
