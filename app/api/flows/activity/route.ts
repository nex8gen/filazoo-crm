import { z } from "zod";
import { listFlowActivity, updateFlowActivity } from "@/lib/data/flow-activity";
import { getWorkspaceViewer } from "@/lib/auth";
import { activityPage, taskViews } from "@/lib/task-activity";
import { createAgentTask, updateAgentTask } from "@/lib/data/agent-tasks";
import { taskChangesSchema, productivityOperationSchemas } from "@/lib/ai/crm-productivity";
import { listTaskAssignees } from "@/lib/data/task-assignees";

const headers = { "Cache-Control": "private, no-store" };
const failure = (error: unknown) => error instanceof Error ? error.message : "Unable to update activity. Please try again.";

export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false, error: "Sign in to view your activity." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const taskId = z.uuid().safeParse(params.get("task"));
  const taskView = z.enum(taskViews).safeParse(params.get("taskView"));
  const alertView = z.enum(["all", "unread"]).safeParse(params.get("alertView"));
  const taskScope = z.enum(["mine", "delegated"]).safeParse(params.get("taskScope"));
  try {
    if (params.get("members") === "1") {
      if (viewer.role === "viewer") return Response.json({ ok: false, error: "Your workspace role is read-only." }, { status: 403, headers });
      return Response.json({ ok: true, version: 2, members: await listTaskAssignees(viewer), viewerId: viewer.id }, { headers });
    }
    const activity = await listFlowActivity(params.get("summary") === "1", { taskPage: activityPage(params.get("taskPage")), alertPage: activityPage(params.get("alertPage")), taskId: taskId.success ? taskId.data : undefined,
      ...(taskView.success ? { taskView: taskView.data } : {}), ...(alertView.success ? { alertView: alertView.data } : {}), ...(params.get("query") ? { query: params.get("query")!.trim().slice(0, 120) } : {}),
      ...(params.get("preview") === "1" ? { preview: true } : {}),
      ...(taskScope.success ? { taskScope: taskScope.data } : {}),
    });
    return Response.json({ ok: true, version: 2, ...activity }, { headers });
  } catch (cause) {
    const detail = cause as { code?: string; message?: string };
    console.error("Task activity lookup failed", { code: detail?.code ?? "unknown", message: detail?.message?.slice(0, 300) ?? "Unknown lookup error" });
    return Response.json({ ok: false, error: "Unable to load tasks and notifications. Please try again." }, { status: 503, headers });
  }
}

export async function PATCH(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false, error: "Sign in to update your activity." }, { status: 401, headers });
  const input = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("task"), id: z.uuid(), expectedUpdatedAt: z.string().min(1), changes: taskChangesSchema, assignedTo: z.uuid().optional() }),
    z.object({ kind: z.literal("alert"), id: z.uuid() }),
  ]).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: "Invalid activity item." }, { status: 400 });
  if (input.data.kind === "task" && viewer.role === "viewer") return Response.json({ ok: false, error: "Your workspace role is read-only." }, { status: 403, headers });
  try {
    if (input.data.kind === "task") {
      const task = await updateAgentTask(viewer, input.data.id, input.data.expectedUpdatedAt, input.data.changes, input.data.assignedTo);
      return Response.json({ ok: true, version: 2, task }, { headers });
    }
    await updateFlowActivity("alert", input.data.id);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: failure(error) }, { status: 400, headers });
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ ok: false, error: "Sign in to create a task." }, { status: 401, headers });
  if (viewer.role === "viewer") return Response.json({ ok: false, error: "Your workspace role is read-only." }, { status: 403, headers });
  const input = z.object({ requestId: z.uuid(), task: productivityOperationSchemas[0], assignedTo: z.uuid().optional() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, error: "Enter a valid task title, priority and due time." }, { status: 400, headers });
  try {
    // Company-linked follow-ups keep their account-owner assignment rules.
    if (input.data.task.companyId) return Response.json({ ok: false, error: "Schedule company follow-ups from the company profile." }, { status: 400, headers });
    const task = await createAgentTask(viewer, input.data.requestId, input.data.task, input.data.assignedTo);
    return Response.json({ ok: true, version: 2, task }, { headers });
  } catch (error) {
    return Response.json({ ok: false, error: failure(error) }, { status: 400, headers });
  }
}
