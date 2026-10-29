import "server-only";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { getViewerMailboxes } from "../data/mailboxes";
import { getAssignedEmailContacts } from "../data/email-access";
import { canViewEmail } from "../email-access";
import { getAutoReply } from "../data/email-auto-reply";
import type { CrmRead } from "./crm-tools";

function safeState(row: Record<string, unknown>) {
  return { id: row.id, enabled: row.enabled, status: row.status, revision: row.revision, recipient: row.recipient,
    mailboxId: row.mailbox_id, assignedTo: row.assigned_to, lastError: row.last_error, lastSentAt: row.last_sent_at,
    invoiceId: row.invoice_id, taskId: row.task_id };
}
export async function readAgentAutoReplies(viewer: WorkspaceViewer, input: CrmRead) {
  if (viewer.role === "viewer") throw new Error("Managing conversation AI requires a sales workspace role.");
  if (input.companyId) throw new Error("Use an exact automation ID or recipient search for conversation AI.");
  if (input.id) {
    const row = await getAutoReply(viewer, input.id);
    return { records: [safeState(row)], coverage: { matching: 1, included: 1, nextOffset: null } };
  }
  const [mailboxes, assigned] = await Promise.all([getViewerMailboxes(viewer.id), getAssignedEmailContacts(viewer)]);
  if (!mailboxes.length) return { records: [], coverage: { matching: 0, included: 0, nextOffset: null } };
  const byId = new Map(mailboxes.map((mailbox) => [mailbox.id, mailbox]));
  let query = createSupabaseAdmin().from("email_auto_replies").select("id,user_id,enabled,status,revision,recipient,mailbox_id,assigned_to,last_error,last_sent_at,invoice_id,task_id", { count: "exact" }).in("mailbox_id", [...byId.keys()]);
  if (viewer.role === "bd_manager") query = query.or(`user_id.eq.${viewer.id},assigned_to.eq.${viewer.id}`);
  if (input.query) query = query.ilike("recipient", `%${input.query.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query.order("id").range(input.offset, input.offset + 9);
  if (error) throw new Error("Unable to read conversation AI settings.");
  const rows = (data ?? []).filter((row) => {
    const mailbox = byId.get(row.mailbox_id);
    return mailbox && (viewer.role !== "bd_manager" || row.user_id === viewer.id || row.assigned_to === viewer.id) && canViewEmail(viewer, row.recipient, assigned, mailbox);
  });
  return { records: rows.map(safeState), coverage: { matching: rows.length === (data ?? []).length ? count : null, included: rows.length,
    nextOffset: count !== null && count > input.offset + (data ?? []).length ? input.offset + (data ?? []).length : null,
    scope: "Accessible conversation settings only; message bodies and credentials are excluded." } };
}
