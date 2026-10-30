import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWorkspaceViewer } from "@/lib/auth";
import { taskWorkflowDetail } from "@/lib/data/task-workflows";
import { executeTaskWorkflow } from "@/lib/data/task-workflow-execution";
import { taskWorkActionSchema } from "@/lib/task-workflows";
import { withMailboxSyncSessions } from "@/lib/mailbox-imap";

export const maxDuration = 180;
const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false, error: "Sign in to view this task." }, { status: 401, headers });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ ok: false, error: "Invalid task." }, { status: 400, headers });
  try { return Response.json({ ok: true, ...await taskWorkflowDetail(viewer, id) }, { headers }); }
  catch { return Response.json({ ok: false, error: "This task or its prepared work is unavailable for your account." }, { status: 404, headers }); }
}
export async function POST(request: Request, context: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403, headers });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false, error: "Sign in to act on this task." }, { status: 401, headers });
  if (viewer.role === "viewer") return Response.json({ ok: false, error: "Your account is read-only." }, { status: 403, headers });
  const { id } = await context.params;
  const input = taskWorkActionSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !input.success) return Response.json({ ok: false, error: "Enter a valid task action and current revision." }, { status: 400, headers });
  try {
    const result = await withMailboxSyncSessions(() => executeTaskWorkflow(viewer, id, input.data));
    revalidatePath("/tasks"); revalidatePath("/invoices"); revalidatePath("/companies");
    return Response.json({ ok: true, ...result }, { headers });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "This action could not be confirmed. Refresh the task.";
    console.error("Task workflow action failed", { taskId: id, action: input.data.action, message: message.slice(0, 300) });
    return Response.json({ ok: false, error: message }, { status: 409, headers });
  }
}
