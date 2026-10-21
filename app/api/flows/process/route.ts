import { requireWorkspaceMember } from "@/lib/auth";
import { processDueFlowRuns } from "@/lib/data/flow-runtime";

export async function POST() {
  await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const results = await processDueFlowRuns();
  return Response.json({ ok: true, processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
