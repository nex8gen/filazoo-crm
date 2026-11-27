import { requireWorkspaceMember } from "@/lib/auth";
import { companyListRequestSchema } from "@/lib/company-list";
import { listCompanyPage } from "@/lib/data/company-list";
import { getSavedSegment } from "@/lib/data/segments";
import { withWorkspaceViewer } from "@/lib/workspace-context";

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const input = companyListRequestSchema.safeParse({ page: params.get("page") ?? 1, pageSize: Number(params.get("pageSize") ?? viewer.preferences?.tablePageSize ?? 25),
    query: params.get("q") ?? "", country: params.get("country") ?? "all", tag: params.get("tag") ?? "all",
    sort: params.get("sort") ?? "createdAt", descending: params.get("direction") !== "asc",
    segment: params.get("segment") ?? undefined, segmentId: params.get("segmentId") ?? undefined });
  if (!input.success) return Response.json({ error: "Invalid company filters." }, { status: 400 });
  return withWorkspaceViewer(viewer, async () => {
    const saved = input.data.segmentId ? await getSavedSegment(input.data.segmentId) : null;
    if (input.data.segmentId && !saved) return Response.json({ error: "Segment not found." }, { status: 404 });
    const context = { ...input.data, segment: saved ? undefined : input.data.segment };
    const asOf = new Date().toISOString();
    const result = await listCompanyPage(context, saved?.rules, asOf);
    return Response.json({ result, request: { ...context, page: result.page }, asOf }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
