import "server-only";
import type { WorkspaceViewer } from "../auth";
import type { EmailFollowup } from "../email-followup";
import type { FollowupActionRecord } from "../email-followup-filters";
import { normalizeMessageId } from "../email-threading";
import { createSupabaseAdmin } from "../supabase/admin";
import { getViewerMailboxes } from "./mailboxes";
import { getAssignedEmailContacts } from "./email-access";
import { canViewEmail } from "../email-access";

/** Status reads never rebuild the inbox, load bodies, contact IMAP, or run AI. */
export async function readFollowupStatus(viewer: WorkspaceViewer, mailboxId: string, messageId: string, references: string[] = []): Promise<EmailFollowup | null> {
  const anchors = [...new Set([messageId, `local:${messageId}`, `thread:local:${messageId}`, ...references].map(id => normalizeMessageId(id)!).filter(Boolean))];
  const [mailboxes, result, assigned] = await Promise.all([
    getViewerMailboxes(viewer.id, true),
    createSupabaseAdmin().from("email_message_followups")
      .select("id,revision,kind,purpose,status,due_at,subject,body,error,task_id,recipient")
      .eq("user_id", viewer.id).eq("mailbox_id", mailboxId).overlaps("anchors", anchors)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle().throwOnError(),
    getAssignedEmailContacts(viewer),
  ]);
  const mailbox = mailboxes.find(mailbox => mailbox.id === mailboxId);
  if (!mailbox) throw new Error("This mailbox is unavailable.");
  const row = result.data;
  if (!row) return null;
  if (!canViewEmail(viewer, row.recipient, assigned, mailbox)) throw new Error("This conversation is unavailable.");
  const { id, revision, kind, status, due_at, subject, body, error, task_id } = row;
  return { id, revision, kind, status, due_at, subject, body, error, task_id, purpose: row.purpose || "followup" } as EmailFollowup;
}

/** Lightweight filter metadata for one authorized mailbox; never returns email bodies. */
export async function listFollowupActions(viewer: WorkspaceViewer, mailboxId: string): Promise<FollowupActionRecord[]> {
  const db = createSupabaseAdmin();
  async function rows(table: string, fields: string) {
    const result: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data } = await db.from(table).select(fields).eq("user_id", viewer.id).eq("mailbox_id", mailboxId).order("id").range(offset, offset + 499).throwOnError();
      result.push(...data as unknown as Record<string, unknown>[]);
      if (data.length < 500) return result;
    }
  }
  const [mailboxes, assigned, followups] = await Promise.all([
    getViewerMailboxes(viewer.id, true), getAssignedEmailContacts(viewer),
    rows("email_message_followups", "id,kind,purpose,status,due_at,message_key,thread_key,anchors,updated_at,recipient,task:crm_tasks(status)"),
  ]);
  const mailbox = mailboxes.find(mailbox => mailbox.id === mailboxId);
  if (!mailbox) throw new Error("This mailbox is unavailable.");
  return followups
    .filter(row => canViewEmail(viewer, String(row.recipient), assigned, mailbox))
    .map(row => {
      const task = (Array.isArray(row.task) ? row.task[0] : row.task) as { status?: string } | null;
      return { id: String(row.id), source: "followup", kind: row.kind as "ai" | "reminder", purpose: row.purpose === "nurture" ? "nurture" : "followup", status: String(row.status),
        messageKey: String(row.message_key), taskStatus: task?.status || null, dueAt: String(row.due_at),
        threadKey: String(row.thread_key), anchors: row.anchors as string[], updatedAt: String(row.updated_at) };
    });
}
