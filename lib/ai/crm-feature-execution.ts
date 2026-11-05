import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getAiSettings, saveAiSettings } from "../data/ai-settings";
import { aiPolicySchema } from "../ai-policy";
import { getUserEmailFooter, saveUserEmailFooter } from "../data/email-footers";
import { cleanEmailFooter } from "../email-footer-html";
import { getViewerMailbox } from "../data/mailboxes";
import type { FeatureOperation } from "./crm-feature-tools";
import type { CrmRead } from "./crm-tools";

async function responseValue(response: Response) {
  const body = await response.json();
  if (!response.ok || body.error || body.ok === false) throw new Error(body.error || "This CRM action could not be confirmed.");
  return body;
}
function localRequest(original: Request, path: string, method: string, body?: unknown) {
  const url = new URL(path, original.url);
  return new Request(url, { method, headers: { "content-type": "application/json", origin: url.origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export async function featureRecords(viewer: WorkspaceViewer, input: CrmRead): Promise<unknown[]> {
  if (input.companyId) throw new Error("Use id to select this resource; companyId is unsupported.");
  if (input.resource === "ai_settings") {
    if (viewer.role !== "admin") throw new Error("AI settings require an administrator.");
    return [await getAiSettings()];
  }
  if (input.resource === "email_footer") return [await getUserEmailFooter(viewer.id)];
  if (input.resource === "task_workflows") {
    if (!input.id || !z.uuid().safeParse(input.id).success) throw new Error("Read tasks first, then use its exact task ID.");
    const { taskWorkflowDetail } = await import("../data/task-workflows");
    return [await taskWorkflowDetail(viewer, input.id)];
  }
  if (input.resource === "invoice_portal") {
    if (!input.id || !z.uuid().safeParse(input.id).success) throw new Error("Choose an actual invoice ID.");
    const { GET } = await import("@/app/api/invoices/[id]/portal/route");
    return [await responseValue(await GET(new Request("http://crm.local/api/invoices/portal"), { params: Promise.resolve({ id: input.id }) }))];
  }
  const db = createSupabaseAdmin();
  if (input.resource === "scheduled_emails") {
    let query = db.from("email_send_operations").select("id,status,scheduled_at,error,updated_at,subject:payload->>subject,to:payload->>to").eq("user_id", viewer.id).in("status", ["scheduled", "preparing", "submitting", "failed", "uncertain"]);
    if (input.id) query = query.eq("id", input.id);
    const { data, error } = await query.order("scheduled_at").range(input.offset, input.offset + 9);
    if (error) throw new Error("Unable to read scheduled emails.");
    return data ?? [];
  }
  if (input.resource === "email_drafts") {
    const mailbox = z.uuid().parse(input.query);
    if (!await getViewerMailbox(viewer.id, mailbox)) throw new Error("This mailbox is unavailable.");
    let query = db.from("email_workbench_drafts").select("id,mailbox_id,revision,updated_at,subject:payload->>subject,to:payload->>to").eq("user_id", viewer.id).eq("mailbox_id", mailbox).is("deleted_at", null);
    if (input.id) query = query.eq("id", input.id);
    const { data, error } = await query.order("updated_at", { ascending: false }).range(input.offset, input.offset + 9);
    if (error) throw new Error("Unable to read saved drafts.");
    return data ?? [];
  }
  throw new Error("Unsupported CRM feature resource.");
}
export async function featureTarget(operation: FeatureOperation, viewer: WorkspaceViewer) {
  const resource = operation.op === "update_ai_settings" ? "ai_settings" : operation.op === "update_email_footer" ? "email_footer" : operation.op === "cancel_scheduled_email" ? "scheduled_emails" : operation.op === "discard_email_draft" ? "email_drafts" : operation.op === "task_workflow_action" ? "task_workflows" : "invoice_portal";
  const id = "invoiceId" in operation ? operation.invoiceId : "taskId" in operation ? operation.taskId : "emailId" in operation ? operation.emailId : "draftId" in operation ? operation.draftId : undefined;
  const records = await featureRecords(viewer, { resource, id, query: "mailboxId" in operation ? operation.mailboxId : "", offset: 0 });
  if (!records.length && !["ai_settings", "email_footer"].includes(resource)) throw new Error("This record is unavailable in your account.");
  const current = records[0];
  if (operation.op === "cancel_scheduled_email" && !["scheduled", "failed"].includes(String((current as { status: string }).status))) throw new Error("This email has already started sending or needs delivery review. It cannot be cancelled.");
  let preview: Record<string, unknown> = { operation, current };
  if (operation.op === "update_ai_settings") {
    const saved = current as Awaited<ReturnType<typeof getAiSettings>>;
    const changes = operation.changes;
    preview = { revision: saved.revision, policy: aiPolicySchema.parse({ ...saved.policy, ...changes, features: { ...saved.policy.features, ...changes.features }, data: { ...saved.policy.data, ...changes.data }, actions: { ...saved.policy.actions, ...changes.actions } }) };
  }
  if (operation.op === "update_email_footer") preview = { footer: cleanEmailFooter(operation.html) };
  return { name: resource.replaceAll("_", " "), value: records, preview };
}
export async function executeFeatureOperation(operation: FeatureOperation, viewer: WorkspaceViewer, actionId: string, preview: Record<string, unknown>, request: Request) {
  if (operation.op === "update_ai_settings") {
    await saveAiSettings(aiPolicySchema.parse(preview.policy), Number(preview.revision), viewer.id);
    return { success: "AI access and behavior settings updated.", href: "/settings" };
  }
  if (operation.op === "update_email_footer") {
    await saveUserEmailFooter(viewer.id, operation.html);
    return { success: "Your email signature was updated.", href: "/email" };
  }
  if (operation.op === "cancel_scheduled_email") {
    const { DELETE } = await import("@/app/api/email/scheduled/route");
    await responseValue(await DELETE(localRequest(request, "/api/email/scheduled", "DELETE", { id: operation.emailId })));
    return { success: "Scheduled email cancelled.", href: "/email" };
  }
  if (operation.op === "discard_email_draft") {
    const { DELETE } = await import("@/app/api/email/drafts/route");
    await responseValue(await DELETE(localRequest(request, "/api/email/drafts", "DELETE", { id: operation.draftId, mailboxId: operation.mailboxId })));
    return { success: "Saved draft discarded.", href: "/email" };
  }
  if (operation.op === "task_workflow_action") {
    const { POST } = await import("@/app/api/tasks/[id]/work/route");
    const result = await responseValue(await POST(localRequest(request, `/api/tasks/${operation.taskId}/work`, "POST", operation.input), { params: Promise.resolve({ id: operation.taskId }) }));
    return { ...result, success: "Task work action completed. Check its saved delivery status for any email.", href: "/tasks" };
  }
  const { POST } = await import("@/app/api/invoices/[id]/portal/route");
  await responseValue(await POST(localRequest(request, `/api/invoices/${operation.invoiceId}/portal`, "POST", operation.op === "portal_reply" ? { action: "reply", id: actionId, body: operation.body } : { action: "shipment", shipment: operation.shipment }), { params: Promise.resolve({ id: operation.invoiceId }) }));
  return { success: operation.op === "portal_reply" ? "Customer portal reply posted." : "Shipment tracking updated.", href: `/invoices/${operation.invoiceId}` };
}
