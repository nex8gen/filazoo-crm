import { processDueFlowRuns } from "@/lib/data/flow-runtime";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const results = await processDueFlowRuns();
  return Response.json({ ok: true, processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
