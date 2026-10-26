import { getWorkspaceViewer } from "@/lib/auth";
import { flowEmailTestSchema } from "@/lib/flow-email-test";
import { testFlowWithEmails } from "@/lib/data/flow-email-test";

export const maxDuration = 300;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) return Response.json({ error: "You cannot test flows with this role." }, { status: 403 });
  const parsed = flowEmailTestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Enter a sample email and complete the flow settings." }, { status: 400 });
  try {
    const result = await testFlowWithEmails(parsed.data, viewer.displayName);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Flow email test failed." }, { status: 400 });
  }
}
