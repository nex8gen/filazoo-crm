import { recoverFlowRun } from "@/lib/data/flow-recovery";

export async function POST(request: Request, context: { params: Promise<{ id: string; runId: string }> }) {
  const body = await request.json().catch(() => null);
  if (body?.action !== "retry" && body?.action !== "cancel") return Response.json({ ok: false, error: "Choose retry or cancel." }, { status: 400 });
  try {
    const { id, runId } = await context.params;
    return Response.json({ ok: true, ...await recoverFlowRun(id, runId, body.action) });
  } catch (cause) {
    return Response.json({ ok: false, error: cause instanceof Error ? cause.message : "Unable to recover this action." }, { status: 409 });
  }
}
