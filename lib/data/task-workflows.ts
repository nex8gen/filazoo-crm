import "server-only";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getInvoice } from "./invoices";
import { canEditInvoice, canManageBilling } from "../invoice-permissions";
import { taskWorkflowInputSchema, type TaskWorkflow, type TaskWorkflowInput, type TaskWorkflowDetail } from "../task-workflows";

export async function taskWorkflowAccess(viewer: WorkspaceViewer, taskId: string, write = false) {
  z.uuid().parse(taskId);
  const db = createSupabaseAdmin();
  const [{ data: task }, { data: workflow }] = await Promise.all([
    db.from("crm_tasks").select("id,company_id,title,notes,status,assigned_to,created_by,assigned_by,updated_at").eq("id", taskId).maybeSingle().throwOnError(),
    db.from("crm_task_workflows").select("*").eq("task_id", taskId).maybeSingle().throwOnError(),
  ]);
  if (!task || !workflow || (![task.assigned_to, task.created_by, task.assigned_by].includes(viewer.id) && !canManageBilling(viewer.role))) throw new Error("This task is unavailable for your account.");
  // A delegated task must not expose another employee's private conversation.
  if (workflow.request_id && workflow.owner_id !== viewer.id) throw new Error("The customer conversation belongs to the task owner. Ask them to share it through the company workspace.");
  const canAct = viewer.role !== "viewer" && (task.assigned_to === viewer.id || canManageBilling(viewer.role));
  if (write && (!canAct || task.status !== "open")) throw new Error("Only an assigned employee or operator can act on an open task.");
  return { task, workflow: workflow as TaskWorkflow, canAct };
}

export async function taskWorkflowDetail(viewer: WorkspaceViewer, taskId: string): Promise<TaskWorkflowDetail> {
  const { task, workflow, canAct } = await taskWorkflowAccess(viewer, taskId);
  const invoice = workflow.invoice_id ? await getInvoice(workflow.invoice_id) : null;
  if (invoice && invoice.document.companyId !== task.company_id) throw new Error("The linked invoice does not belong to this task's customer.");
  return { workflow, invoice, canAct: canAct && task.status === "open", canIssue: canManageBilling(viewer.role), canEditInvoice: Boolean(invoice && canEditInvoice(viewer, invoice)), taskStatus: task.status };
}

export async function validateTaskWorkflow(viewer: WorkspaceViewer, companyId: string, input: TaskWorkflowInput) {
  const db = createSupabaseAdmin();
  const parsed = taskWorkflowInputSchema.parse(input);
  const { data: company } = await db.from("companies").select("id").eq("id", companyId).maybeSingle().throwOnError();
  if (!company) throw new Error("Choose an existing company for this task.");
  if (viewer.role === "bd_manager") {
    const { data } = await db.from("pipeline").select("company_id").eq("company_id", companyId).eq("owner_id", viewer.id).maybeSingle().throwOnError();
    if (!data) throw new Error("Only use a customer assigned to you.");
  }
  if (parsed.invoiceId) {
    const invoice = await getInvoice(parsed.invoiceId);
    if (!invoice || invoice.document.companyId !== companyId || invoice.status === "void") throw new Error("Choose an active invoice belonging to this customer.");
  }
  if (parsed.kind === "payment_follow_up" && !parsed.invoiceId) throw new Error("Choose the invoice to follow up on.");
  return parsed;
}

export async function attachTaskWorkflow(viewer: WorkspaceViewer, taskId: string, input: TaskWorkflowInput, ownerId = viewer.id) {
  const db = createSupabaseAdmin();
  await db.from("crm_task_workflows").upsert({ task_id: taskId, owner_id: ownerId, kind: input.kind, invoice_id: input.invoiceId ?? null,
    payload: { input }, status: "preparing", last_actor_id: viewer.id }, { onConflict: "task_id", ignoreDuplicates: true }).throwOnError();
  const { data } = await db.from("crm_task_workflows").select("owner_id,payload,kind").eq("task_id", taskId).single().throwOnError();
  if (data.owner_id !== ownerId || data.kind !== input.kind || !isDeepStrictEqual(data.payload.input, input)) throw new Error("This task ID already belongs to different work. Refresh before retrying.");
}

export async function processTaskWorkflows(options: { budgetMs?: number; maxJobs?: number; taskId?: string } = {}) {
  const db = createSupabaseAdmin();
  const deadline = Date.now() + (options.budgetMs ?? 100_000);
  let prepared = 0, failed = 0;
  for (let i = 0; i < (options.maxJobs ?? 3) && Date.now() < deadline - 10_000; i++) {
    const { data } = await db.rpc("claim_task_workflow", { p_task: options.taskId ?? null }).throwOnError();
    const work = data?.[0] as TaskWorkflow | undefined;
    if (!work) break;
    try {
      const { prepareTaskWorkflow } = await import("./task-workflow-preparation");
      await prepareTaskWorkflow(work); prepared++;
    } catch (cause) {
      failed++;
      const error = cause instanceof Error ? cause.message.slice(0, 600) : "Preparation is unavailable. Retry this task.";
      await db.from("crm_task_workflows").update({ status: "blocked", blockers: [error], payload: { ...work.payload, error }, lease_until: null,
        revision: work.revision + 1, updated_at: new Date().toISOString() }).eq("task_id", work.task_id).eq("revision", work.revision).throwOnError();
    }
    if (options.taskId) break;
  }
  return { prepared, failed };
}
