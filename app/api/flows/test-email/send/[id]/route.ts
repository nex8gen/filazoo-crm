import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { cancelFlowEmailDeliveryTest, loadFlowEmailDeliveryTest, processFlowEmailDeliveryTest } from "@/lib/data/flow-email-delivery-test";

export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Context, action: "read" | "process" | "cancel") {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) return Response.json({ error: "You cannot send workflow tests with this role." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid test run." }, { status: 400 });
  try {
    const run = await (action === "read" ? loadFlowEmailDeliveryTest(id, viewer.id) : action === "cancel" ? cancelFlowEmailDeliveryTest(id, viewer.id) : processFlowEmailDeliveryTest(id, viewer.id));
    return Response.json({ ok: true, run }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "Unable to load delivery test.";
    return Response.json({ error }, { status: error === "Test run not found." ? 404 : 400 });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, "read");
export const POST = (request: Request, context: Context) => handle(request, context, "process");
export const DELETE = (request: Request, context: Context) => handle(request, context, "cancel");
