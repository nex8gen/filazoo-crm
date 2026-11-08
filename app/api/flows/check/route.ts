import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { flowCheckInputSchema } from "@/lib/flow-check";
import { checkFlow } from "@/lib/data/flow-check";
import { workflowErrorMessage } from "@/lib/flow-execution-errors";

export const maxDuration = 15;
export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = flowCheckInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: parsed.error.issues[0]?.message || "Complete the workflow settings first." }, { status: 400 });
  try {
    const result = await withWorkspaceViewer(viewer, () => checkFlow(parsed.data, viewer));
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const error = workflowErrorMessage(cause);
    return Response.json({ ok: false, error }, { status: /owner|administrator|Access denied/.test(error) ? 403 : error === "Workflow not found." ? 404 : 500 });
  }
}
