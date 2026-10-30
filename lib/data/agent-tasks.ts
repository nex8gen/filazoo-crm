import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { isAutoReplySchemaMissing } from "../email-auto-reply";
import { productivityOperationSchema, taskChangesSchema } from "../ai/crm-productivity";
import { validateTaskAssignee } from "./task-assignees";

export const taskFields = "id,company_id,assigned_to,created_by,assigned_by,follows_company_owner,title,notes,priority,status,due_at,completed_at,updated_at";
function canWrite(viewer: WorkspaceViewer) {
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) throw new Error("Your workspace role is read-only.");
}
export async function editableAgentTask(viewer: WorkspaceViewer, id: string) {
  canWrite(viewer); z.uuid().parse(id);
  const db = createSupabaseAdmin();
  const { data, error } = await db.from("crm_tasks").select(taskFields).eq("id", id).maybeSingle();
  if (error) throw new Error("Unable to read your task.");
  if (!data || ![data.assigned_to, data.created_by, data.assigned_by].includes(viewer.id)) throw new Error("This task is unavailable or belongs to another teammate.");
  const automation = await db.from("email_auto_replies").select("id").eq("task_id", id).eq("enabled", true).maybeSingle();
  if (automation.error && !isAutoReplySchemaMissing(automation.error)) throw new Error("Unable to check task automation.");
  if (automation.data) throw new Error("This task is managed by AI auto-reply. Approve its shipping or stop that conversation's AI instead.");
  return data;
}

export async function createAgentTask(viewer: WorkspaceViewer, actionId: string, input: unknown, assignedTo?: string) {
  canWrite(viewer); z.uuid().parse(actionId);
  const operation = productivityOperationSchema.parse(input);
  if (operation.op !== "create_task") throw new Error("Invalid task operation.");
  if (operation.workflow) {
    const { validateTaskWorkflow } = await import("./task-workflows");
    await validateTaskWorkflow(viewer, operation.companyId!, operation.workflow);
  }
  if (assignedTo) { z.uuid().parse(assignedTo); await validateTaskAssignee(assignedTo); }
  const payload = { id: actionId, assigned_to: assignedTo ?? viewer.id, created_by: viewer.id, assigned_by: viewer.id, company_id: operation.companyId ?? null, title: operation.title, notes: operation.notes, priority: operation.priority, due_at: operation.dueAt, status: "open" };
  const db = createSupabaseAdmin();
  const { error } = await db.from("crm_tasks").upsert(payload, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("Unable to create your task.");
  const { data, error: readError } = await db.from("crm_tasks").select(taskFields).eq("id", actionId).eq("created_by", viewer.id).maybeSingle();
  const sameDue = (value: string | null) => value === operation.dueAt || (value !== null && operation.dueAt !== null && Date.parse(value) === Date.parse(operation.dueAt));
  if (readError || !data || data.assigned_to !== payload.assigned_to || data.title !== payload.title || (data.notes ?? "") !== payload.notes || data.priority !== payload.priority || data.company_id !== payload.company_id || data.status !== "open" || !sameDue(data.due_at))
    throw new Error("The task could not be confirmed. Refresh Tasks before retrying.");
  if (operation.workflow) {
    const { attachTaskWorkflow } = await import("./task-workflows");
    await attachTaskWorkflow(viewer, actionId, operation.workflow, payload.assigned_to);
  }
  return data;
}

export async function updateAgentTask(viewer: WorkspaceViewer, id: string, expectedUpdatedAt: string, changes: unknown, assignedTo?: string) {
  const task = await editableAgentTask(viewer, id);
  const patch = taskChangesSchema.parse(changes);
  const scheduled = task.notes === "Scheduled from intelligent next follow-up recommendation.";
  const managed = scheduled || task.notes?.startsWith("Company purchase analysis:");
  const reassigning = assignedTo !== undefined && assignedTo !== task.assigned_to;
  if (reassigning) {
    z.uuid().parse(assignedTo);
    if (managed || task.follows_company_owner) throw new Error("Change this company's account owner to transfer its managed follow-ups.");
    await validateTaskAssignee(assignedTo);
  }
  if (managed && patch.notes !== undefined && patch.notes !== task.notes) throw new Error("The company follow-up link cannot be changed. Create a personal task for separate notes.");
  if (scheduled && patch.dueAt === null) throw new Error("Company follow-ups require a due time. Cancel the task to remove the scheduled follow-up.");
  if (scheduled && task.status !== "open" && patch.status === "open") throw new Error("Schedule a new follow-up from the company profile.");
  if (task.updated_at !== expectedUpdatedAt) throw new Error("This task changed. Prepare a new update.");
  const { dueAt, status, ...fields } = patch;
  const { data, error } = await createSupabaseAdmin().from("crm_tasks").update({ ...fields,
    ...(dueAt !== undefined ? { due_at: dueAt } : {}),
    ...(status ? { status, completed_at: status === "done" ? new Date().toISOString() : null } : {}), updated_at: new Date().toISOString(),
    ...(reassigning ? { assigned_to: assignedTo, assigned_by: viewer.id } : {}),
  }).eq("id", id).eq("updated_at", expectedUpdatedAt).select(taskFields).maybeSingle();
  if (error || !data) throw new Error("This task changed or could not be saved. Refresh Tasks and try again.");
  return data;
}
