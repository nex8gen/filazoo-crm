import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { createAgentTask, editableAgentTask, updateAgentTask } from "../data/agent-tasks";
import { getInvoice } from "../data/invoices";
import { canReadInvoices } from "../invoice-permissions";
import { findAutoReply, getAutoReply, presentAutoReply } from "../data/email-auto-reply";
import { POST as changeAutoReply } from "@/app/api/email/auto-reply/route";
import { POST as addBusinessFact, DELETE as deleteBusinessFact } from "@/app/api/email/auto-reply/knowledge/route";
import { invoiceDocumentSchema, invoiceTotals } from "../invoices";
import { companyExportSnapshot } from "./company-export-records";
import { loadAgentCompany, loadAgentEmails } from "./agent-records";
import type { ProductivityOperation } from "./crm-productivity";

async function one(table: string, fields: string, id: string) {
  const { data, error } = await createSupabaseAdmin().from(table).select(fields).eq("id", id).maybeSingle();
  if (error || !data) throw new Error("This CRM record is unavailable.");
  return data as unknown as Record<string, unknown>;
}
export async function productivityTarget(operation: ProductivityOperation, viewer: WorkspaceViewer) {
  if (operation.op === "export_companies") {
    const snapshot = await companyExportSnapshot(operation.selection);
    return { name: `${snapshot.records.length} companies`, value: snapshot.value, preview: snapshot.preview };
  }
  if (operation.op === "create_task") {
    const company = operation.companyId ? await loadAgentCompany(operation.companyId) : null;
    return { name: operation.title, value: company ? { id: company.id, name: company.fields.name } : null,
      preview: { title: operation.title, notes: operation.notes, priority: operation.priority, dueAt: operation.dueAt, assignedTo: "Me", ...(company ? { company: company.fields.name } : {}) } };
  }
  if (operation.op === "update_task") {
    const task = await editableAgentTask(viewer, operation.taskId);
    return { name: task.title, value: task, preview: { revision: task.updated_at, task: { title: task.title, notes: task.notes, priority: task.priority, dueAt: task.due_at, status: task.status, ...operation.changes } } };
  }
  if (operation.op === "download_document") {
    if (operation.kind === "invoice") {
      if (!canReadInvoices(viewer.role)) throw new Error("Your role does not have access to billing.");
      const invoice = await getInvoice(operation.id);
      if (!invoice) throw new Error("The invoice is unavailable.");
      return { name: `INV-${String(invoice.number).padStart(6, "0")}`, value: invoice, preview: { documentType: "Invoice PDF", customer: invoice.document.customerName, status: invoice.status } };
    }
    const catalog = await one("catalogs", "id,user_id,company_id,currency,version,product_skus,price_date,pdf_url", operation.id);
    if (catalog.user_id !== viewer.id) throw new Error("This catalog belongs to another account or is unavailable.");
    return { name: `Catalog v${catalog.version}`, value: catalog, preview: { documentType: "Catalog PDF", currency: catalog.currency, version: catalog.version, products: catalog.product_skus } };
  }
  if (operation.op === "conversation_auto_reply") {
    const source = await loadAgentEmails(viewer, operation.emailId, undefined, operation.mailboxId);
    const email = source.current;
    if (!email?.messageId || !z.uuid().safeParse(source.mailboxId).success) throw new Error("Select a saved mailbox email with verified message headers.");
    const mailboxId = source.mailboxId!;
    const found = await findAutoReply(viewer, mailboxId, email.messageId);
    if (operation.enabled && !found.conversation.some((message) => message.direction === "inbound" && message.messageId)) throw new Error("Enable AI only on a conversation with a received customer email.");
    const state = presentAutoReply(found.row);
    const reference = { mailboxId, messageId: email.messageId, automationId: found.row?.id ?? null };
    return { name: email.subject || email.contact, value: operation.enabled ? { ...reference, state } : reference,
      preview: { enabled: operation.enabled, alreadyEnabled: state?.enabled ?? false, recipient: found.row?.recipient ?? email.contact, currentStatus: state?.status ?? "off", revision: found.row?.revision ?? 0, ...reference,
        effect: operation.enabled ? "Future customer replies may be sent automatically from this conversation's receiving mailbox." : "Pause AI replies for this conversation; messages and invoices are preserved." } };
  }
  if (operation.op === "approve_auto_reply_shipping") {
    const row = await getAutoReply(viewer, operation.automationId);
    if (!row.enabled || row.status !== "waiting_shipping" || !row.pending_document) throw new Error("This conversation is not waiting for shipping approval.");
    if (row.assigned_to !== viewer.id && !["admin", "operator"].includes(viewer.role)) throw new Error("Only the assigned user or an operator can approve shipping.");
    const document = invoiceDocumentSchema.parse({ ...row.pending_document, shippingMinor: operation.shippingMinor });
    return { name: row.recipient, value: presentAutoReply(row), preview: { recipient: row.recipient, revision: row.revision, document, totalMinor: invoiceTotals(document).total,
      effect: "Approve this shipping amount and queue the automatic invoice reply. This may send an email." } };
  }
  if (!["admin", "operator"].includes(viewer.role)) throw new Error("Approved business facts require an admin or operator.");
  if (operation.op === "add_business_fact") return { name: operation.title, value: null, preview: { title: operation.title, content: operation.content, effect: "Save this explicitly approved business fact for future AI replies." } };
  const fact = await one("email_reply_knowledge", "id,title,content", operation.factId);
  return { name: String(fact.title), value: fact, preview: { title: fact.title, content: fact.content, effect: "Delete this approved business fact. Future AI replies will no longer use it." } };
}

async function applyRoute(handler: (request: Request) => Promise<Response>, request: Request, pathname: string, body?: object) {
  const url = new URL(pathname, request.url);
  const response = await handler(new Request(url, { method: body ? "POST" : "DELETE", headers: { origin: url.origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "The CRM did not confirm this operation.");
  return result;
}
export async function executeProductivityOperation(operation: ProductivityOperation, viewer: WorkspaceViewer, actionId: string, preview: Record<string, unknown>, request: Request) {
  switch (operation.op) {
    case "create_task": {
      const task = await createAgentTask(viewer, actionId, operation);
      revalidatePath("/tasks");
      return { success: "Your task was created.", taskId: task.id, href: "/tasks" };
    }
    case "update_task": {
      // Reloading and an atomic timestamp predicate guard the gap after approval.
      const saved = await updateAgentTask(viewer, operation.taskId, String(preview.revision), operation.changes);
      revalidatePath("/tasks");
      return { success: "Your task was updated.", taskId: saved.id, href: "/tasks" };
    }
    case "export_companies": return { success: `CSV export ready for ${preview.count} companies. Open the result to download.`, href: `/api/ai/assistant/download?id=${actionId}` };
    case "download_document": return { success: "Open the result to download the saved PDF.", href: operation.kind === "invoice" ? `/api/invoices/${operation.id}/pdf` : `/api/catalogs/${operation.id}/pdf?download=1` };
    case "conversation_auto_reply": {
      if (operation.enabled && preview.alreadyEnabled) return { success: "AI auto-reply is already enabled. Its current review state was preserved.", href: "/emails" };
      if (!operation.enabled && !preview.automationId) return { success: "AI auto-reply is already off for this conversation.", href: "/emails" };
      const result = await applyRoute(changeAutoReply, request, "/api/email/auto-reply", operation.enabled
        ? { action: "enable", mailboxId: preview.mailboxId, senderId: preview.mailboxId, messageId: preview.messageId, revision: preview.revision }
        : { action: "stop", id: preview.automationId });
      return { success: operation.enabled ? "AI auto-reply is enabled for future replies in this conversation." : "AI auto-reply was paused for this conversation.", automationId: result.automation?.id, href: "/emails" };
    }
    case "approve_auto_reply_shipping": {
      await applyRoute(changeAutoReply, request, "/api/email/auto-reply", { action: "shipping", id: operation.automationId, revision: preview.revision, shippingMinor: operation.shippingMinor });
      return { success: "Shipping was approved and the automatic reply was queued. Delivery is not yet confirmed.", automationId: operation.automationId, href: "/tasks" };
    }
    case "add_business_fact": {
      const result = await applyRoute(addBusinessFact, request, "/api/email/auto-reply/knowledge", { title: operation.title, content: operation.content });
      return { success: "The approved business fact was saved for future AI replies.", factId: result.fact?.id, href: "/emails" };
    }
    case "delete_business_fact": {
      await applyRoute(deleteBusinessFact, request, `/api/email/auto-reply/knowledge?id=${operation.factId}`);
      return { success: "The approved business fact was deleted.", href: "/emails" };
    }
  }
}
