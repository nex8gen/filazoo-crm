import { getWorkspaceViewer } from "@/lib/auth";
import { flowPreviewSchema } from "@/lib/flow-preview";
import { previewFlow } from "@/lib/data/flow-preview";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const parsed = flowPreviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Complete the workflow settings before previewing." }, { status: 400 });
  try {
    return Response.json(await previewFlow(parsed.data, viewer.id, viewer.role === "admin"), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to preview this journey." }, { status: 400 });
  }
}
