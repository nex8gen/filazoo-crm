import { getWorkspaceViewer } from "@/lib/auth";
import { flowEmailDeliveryTestSchema } from "@/lib/flow-email-test";
import { startFlowEmailDeliveryTest } from "@/lib/data/flow-email-delivery-test";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) return Response.json({ error: "You cannot send flow tests with this role." }, { status: 403 });
  const parsed = flowEmailDeliveryTestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Enter a test recipient and one sample email." }, { status: 400 });
  try {
    const run = await startFlowEmailDeliveryTest(parsed.data, viewer.id, viewer.displayName);
    return Response.json({ ok: true, run }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "Unable to start the real delivery test." }, { status: 400 });
  }
}
