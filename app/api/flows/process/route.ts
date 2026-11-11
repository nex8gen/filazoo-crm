import { requireWorkspaceMember } from "@/lib/auth";
import { processDueFlowRuns } from "@/lib/data/flow-runtime";

export const maxDuration = 300;

export async function POST() {
  await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const results = await processDueFlowRuns(5, { budgetMs: 180_000, actionDeadline: Date.now() + 240_000 });
  return Response.json({ ok: true, processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
