import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { listReplyRequests, cancelReplyRequest } from "@/lib/data/customer-reply-requests";
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false }, { status: 401, headers });
  if (viewer.role === "viewer") return Response.json({ ok: false }, { status: 403, headers });
  try { return Response.json({ ok: true, requests: await listReplyRequests(viewer) }, { headers }); }
  catch { return Response.json({ ok: false, error: "Unable to load customer waits. Please refresh." }, { status: 503, headers }); }
}
export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false }, { status: 403, headers });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false }, { status: 401, headers });
  const input = z.object({ id: z.uuid(), action: z.literal("cancel") }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: "Invalid waiting request." }, { status: 400, headers });
  try { return Response.json({ ok: true, ...await cancelReplyRequest(viewer, input.data.id) }, { headers }); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to stop waiting." }, { status: 400, headers }); }
}
