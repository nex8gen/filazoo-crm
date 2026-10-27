import { processDueFlowRuns } from "@/lib/data/flow-runtime";
import { env } from "@/lib/env";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const task = new URL(request.url).searchParams.get("task");
  if (task === "health") return Response.json({ ok: true, liveSending: !env.dryRun, version: "flow-live-v2" }, { headers: { "Cache-Control": "no-store" } });
  const results = await processDueFlowRuns(50, { syncMailbox: task !== "resume" });
  return Response.json({ ok: true, processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
