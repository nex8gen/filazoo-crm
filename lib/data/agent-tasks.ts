import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { isAutoReplySchemaMissing } from "../email-auto-reply";
import { productivityOperationSchema, taskChangesSchema } from "../ai/crm-productivity";

export const taskFields = "id,company_id,assigned_to,title,notes,priority,status,due_at,completed_at,updated_at";
function canWrite(viewer: WorkspaceViewer) {
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) throw new Error("Your workspace role is read-only.");
}
export async function editableAgentTask(viewer: WorkspaceViewer, id: string) {
  canWrite(viewer); z.uuid().parse(id);
  const db = createSupabaseAdmin();
  const { data, error } = await db.from("crm_tasks").select(taskFields).eq("id", id).eq("assigned_to", viewer.id).maybeSingle();
  if (error) throw new Error("Unable to read your task.");
  if (!data) throw new Error("This task is unavailable or belongs to another teammate.");
  const automation = await db.from("email_auto_replies").select("id").eq("task_id", id).eq("enabled", true).maybeSingle();
  if (automation.error && !isAutoReplySchemaMissing(automation.error)) throw new Error("Unable to check task automation.");
  if (automation.data) throw new Error("This task is managed by AI auto-reply. Approve its shipping or stop that conversation's AI instead.");
  return data;
}

export async function createAgentTask(viewer: WorkspaceViewer, actionId: string, input: unknown) {
  canWrite(viewer); z.uuid().parse(actionId);
  const operation = productivityOperationSchema.parse(input);
  if (operation.op !== "create_task") throw new Error("Invalid task operation.");
  const payload = { id: actionId, assigned_to: viewer.id, company_id: operation.companyId ?? null, title: operation.title, notes: operation.notes, priority: operation.priority, due_at: operation.dueAt, status: "open" };
  const db = createSupabaseAdmin();
  const { error } = await db.from("crm_tasks").upsert(payload, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("Unable to create your task.");
  const { data, error: readError } = await db.from("crm_tasks").select(taskFields).eq("id", actionId).eq("assigned_to", viewer.id).maybeSingle();
  const sameDue = (value: string | null) => value === operation.dueAt || (value !== null && operation.dueAt !== null && Date.parse(value) === Date.parse(operation.dueAt));
  if (readError || !data || data.title !== payload.title || (data.notes ?? "") !== payload.notes || data.priority !== payload.priority || data.company_id !== payload.company_id || data.status !== "open" || !sameDue(data.due_at))
    throw new Error("The task could not be confirmed. Refresh Tasks before retrying.");
  return data;
}

export async function updateAgentTask(viewer: WorkspaceViewer, id: string, expectedUpdatedAt: string, changes: unknown) {
  const task = await editableAgentTask(viewer, id);
  const patch = taskChangesSchema.parse(changes);
  const scheduled = task.notes === "Scheduled from intelligent next follow-up recommendation.";
  const managed = scheduled || task.notes?.startsWith("Company purchase analysis:");
  if (managed && patch.notes !== undefined && patch.notes !== task.notes) throw new Error("The company follow-up link cannot be changed. Create a personal task for separate notes.");
  if (scheduled && patch.dueAt === null) throw new Error("Company follow-ups require a due time. Cancel the task to remove the scheduled follow-up.");
  if (scheduled && task.status !== "open" && patch.status === "open") throw new Error("Schedule a new follow-up from the company profile.");
  if (task.updated_at !== expectedUpdatedAt) throw new Error("This task changed. Prepare a new update.");
  const { dueAt, status, ...fields } = patch;
  const { data, error } = await createSupabaseAdmin().from("crm_tasks").update({ ...fields,
    ...(dueAt !== undefined ? { due_at: dueAt } : {}),
    ...(status ? { status, completed_at: status === "done" ? new Date().toISOString() : null } : {}), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("assigned_to", viewer.id).eq("updated_at", expectedUpdatedAt).select(taskFields).maybeSingle();
  if (error || !data) throw new Error("This task changed or could not be saved. Refresh Tasks and try again.");
  return data;
}
