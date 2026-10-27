import { z } from "zod";
import { listFlowActivity, updateFlowActivity } from "@/lib/data/flow-activity";

export async function GET(request: Request) {
  const activity = await listFlowActivity(new URL(request.url).searchParams.get("summary") === "1");
  return Response.json({ ok: true, ...activity }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  const input = z.object({ kind: z.enum(["task", "alert"]), id: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: "Invalid activity item." }, { status: 400 });
  try {
    await updateFlowActivity(input.data.kind, input.data.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to update activity." }, { status: 400 });
  }
}
