import { requireWorkspaceMember } from "@/lib/auth";
import { listFlowHistory } from "@/lib/data/flow-history";
import { flowHistoryFilters, type FlowHistoryFilter } from "@/lib/flow-history";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const page = Number(params.get("page") || "0");
  const kind = params.get("kind") || "all";
  const query = (params.get("query") || "").trim();
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)
    || !Number.isSafeInteger(page) || page < 0 || page > 1000 || query.length > 120
    || !flowHistoryFilters.includes(kind as FlowHistoryFilter)) {
    return Response.json({ ok: false, error: "Choose valid history filters." }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, ...await listFlowHistory(id, { page, query, kind: kind as FlowHistoryFilter }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Unable to load flow history.";
    return Response.json({ ok: false, error }, { status: error === "Workflow not found." ? 404 : 500 });
  }
}
