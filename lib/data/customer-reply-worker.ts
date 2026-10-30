import "server-only";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { authorizeReplyRequest, type ReplyRequestRow } from "./customer-reply-requests";
import { loadSyncedMailbox, loadMailboxMessageContent } from "./mailbox-sync";
import { matchesCustomerReply, replyTaskEvidence, replyTaskNotes, replyRequestThreadUrl } from "../customer-reply-workflow";

/** Bounded, restart-safe polling. Database CAS and an atomic RPC arbitrate concurrent workers. */
export async function processCustomerReplies(options: { mailboxId?: string; sync?: boolean; budgetMs?: number } = {}) {
  const db = createSupabaseAdmin();
  let query = db.from("agent_reply_requests").select("*").in("status", ["sending", "waiting", "uncertain"]).is("task_id", null)
    .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(50);
  if (options.mailboxId) query = query.eq("mailbox_id", options.mailboxId);
  const { data } = await query.throwOnError();
  const mailboxLoads = new Map<string, ReturnType<typeof loadSyncedMailbox>>();
  const deadline = Date.now() + (options.budgetMs ?? 150000);
  let checked = 0, completed = 0, errors = 0;
  for (const row of (data ?? []) as ReplyRequestRow[]) {
    if (Date.now() >= deadline) break;
    try {
      const [{ data: member }, { data: account, error: accountError }] = await Promise.all([
        db.from("workspace_members").select("role,activated_at,display_name").eq("user_id", row.user_id).maybeSingle().throwOnError(),
        db.auth.admin.getUserById(row.user_id),
      ]);
      const user = account?.user;
      if (accountError) throw new Error("Account verification unavailable.");
      if (!member?.activated_at || member.role !== row.owner_role || !user || (user.banned_until && Date.parse(user.banned_until) > Date.now())) {
        await db.from("agent_reply_requests").update({ status: "blocked", revision: row.revision + 1, last_error: "Account access changed.", updated_at: new Date().toISOString() }).eq("id", row.id).eq("revision", row.revision).throwOnError();
        continue;
      }
      const viewer = { id: row.user_id, role: member.role, email: user.email ?? null, displayName: member.display_name } as WorkspaceViewer;
      let mailbox;
      try { mailbox = await authorizeReplyRequest(viewer, row); }
      catch {
        // Configuration can be fixed; keep the wait visible and retry without leaking or sending anything.
        throw new Error("Mailbox or customer access unavailable. Review this wait.");
      }
      const finish = async (outcome: string, evidence: ReturnType<typeof replyTaskEvidence> | null = null) => {
        const notes = outcome === "uncertain" ? `${row.task_notes}\n\nEmail delivery could not be confirmed. Check Sent and the recipient before taking any action. Do not resend automatically.` : replyTaskNotes(row, evidence, outcome === "received" ? "reply" : outcome);
        const { data: done } = await db.rpc("finish_agent_reply_request", { p_id: row.id, p_user_id: row.user_id, p_revision: row.revision,
          p_outcome: outcome, p_evidence: evidence, p_notes: notes, p_thread_url: replyRequestThreadUrl(row.mailbox_id, row.thread_key) }).throwOnError();
        if (done) completed++;
      };
      if (row.status === "sending") {
        if (Date.parse(row.send_started_at ?? row.created_at) > Date.now() - 10 * 60000) continue;
        // SMTP may have completed before the process stopped. Recover only from the actual saved Sent receipt.
        const { data: sent } = await db.from("mailbox_sent_messages").select("message_id,to_email,status,mailbox_id,user_id").eq("id", row.id).maybeSingle().throwOnError();
        if (sent?.status === "sent" && sent.message_id && sent.to_email.toLowerCase() === row.recipient && sent.mailbox_id === row.mailbox_id && sent.user_id === row.user_id) {
          const { normalizeMessageId } = await import("../email-threading");
          await db.from("agent_reply_requests").update({ status: "waiting", message_id: normalizeMessageId(sent.message_id), sent_record_id: row.id, revision: row.revision + 1, updated_at: new Date().toISOString() }).eq("id", row.id).eq("revision", row.revision).eq("status", "sending").throwOnError();
        } else await finish("uncertain");
        continue;
      }
      if (row.status === "uncertain") { await finish("uncertain"); continue; }
      if (Date.parse(row.expires_at) <= Date.now()) { await finish("expired"); continue; }
      let loaded = mailboxLoads.get(mailbox.id);
      if (!loaded) { loaded = loadSyncedMailbox(mailbox, { sync: false, includeContent: false }); mailboxLoads.set(mailbox.id, loaded); }
      const inbox = await loaded;
      if (inbox.error) throw new Error("Incoming email could not be refreshed; waiting continues.");
      const candidate = inbox.messages.filter((email) => matchesCustomerReply(row, email)).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))[0];
      if (candidate) {
        const email = !candidate.bodyLoaded && candidate.uid && candidate.uidValidity ? await loadMailboxMessageContent(mailbox, candidate.uid, candidate.uidValidity) : candidate;
        if (matchesCustomerReply(row, email)) await finish("received", replyTaskEvidence(email));
      }
      await db.from("agent_reply_requests").update({ last_checked_at: new Date().toISOString(), last_error: null }).eq("id", row.id).eq("status", "waiting").eq("revision", row.revision).throwOnError();
      checked++;
    } catch {
      errors++;
      await db.from("agent_reply_requests").update({ last_checked_at: new Date().toISOString(), last_error: "Reply check unavailable. Review mailbox and customer access; no email was sent.", updated_at: new Date().toISOString() }).eq("id", row.id).eq("revision", row.revision);
    }
  }
  return { checked, completed, errors };
}
