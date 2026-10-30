import { createHash } from "node:crypto";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { emailSendSchema, type EmailSendInput } from "../email-workbench";

export type SendOperation = { id: string; user_id: string; payload: EmailSendInput; status: string; request_hash: string; result: Record<string, unknown> | null; updated_at: string };

export async function reserveEmailSend(viewer: WorkspaceViewer, input: EmailSendInput) {
  const db = createSupabaseAdmin();
  const { requestId, scheduleAt, ...message } = input;
  const hash = createHash("sha256").update(JSON.stringify(message)).digest("hex");
  const scheduled = Boolean(scheduleAt);
  if (scheduled && (Date.parse(scheduleAt!) < Date.now() + 60_000 || Date.parse(scheduleAt!) > Date.now() + 365 * 86400_000)) throw new Error("Choose a send time between one minute and one year from now.");
  const { error } = await db.from("email_send_operations").insert({ user_id: viewer.id, id: requestId, request_hash: hash, payload: input, status: scheduled ? "scheduled" : "preparing", scheduled_at: scheduleAt || null });
  if (error && error.code !== "23505") throw new Error("Unable to reserve this send. Your draft is retained; no email was sent.");
  if (!error) return { reserved: !scheduled, scheduled, operation: null };
  const { data } = await db.from("email_send_operations").select("*").eq("user_id", viewer.id).eq("id", requestId).single().throwOnError();
  const operation = data as SendOperation;
  if (operation.request_hash !== hash) throw new Error("This send ID belongs to another version of this message. Reopen the saved draft before sending.");
  if (operation.status === "failed" && !scheduled) {
    const { data: claimed } = await db.from("email_send_operations").update({ status: "preparing", error: null, updated_at: new Date().toISOString() }).eq("user_id", viewer.id).eq("id", requestId).eq("status", "failed").select("id").maybeSingle().throwOnError();
    if (claimed) return { reserved: true, scheduled: false, operation: null };
  }
  return { reserved: false, scheduled: operation.status === "scheduled", operation };
}

export async function updateEmailSend(userId: string, id: string, status: string, result?: Record<string, unknown>, error?: string) {
  await createSupabaseAdmin().from("email_send_operations").update({ status, updated_at: new Date().toISOString(), ...(result ? { result } : {}), error: error || null, ...(status === "sent" ? { payload: {} } : {}) }).eq("user_id", userId).eq("id", id).throwOnError();
}

/** Scheduled sends use the exact same validated delivery path as manual sends. */
export async function processScheduledEmails(deliver: (viewer: WorkspaceViewer, input: EmailSendInput, reserved: boolean) => Promise<Response>) {
  const db = createSupabaseAdmin();
  await db.from("email_send_operations").update({ status: "uncertain", error: "Delivery was interrupted. Check Sent before sending again." }).eq("status", "submitting").lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString()).throwOnError();
  await db.from("email_send_operations").update({ status: "failed", error: "Preparation was interrupted before SMTP. Reopen this email as a draft to retry." }).eq("status", "preparing").lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString()).throwOnError();
  const { data } = await db.from("email_send_operations").select("*").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(10).throwOnError();
  let processed = 0;
  for (const operation of (data || []) as SendOperation[]) {
    const { data: claimed } = await db.from("email_send_operations").update({ status: "preparing", updated_at: new Date().toISOString() }).eq("user_id", operation.user_id).eq("id", operation.id).eq("status", "scheduled").select("id").maybeSingle().throwOnError();
    if (!claimed) continue;
    try {
      const { data: member } = await db.from("workspace_members").select("role,display_name,activated_at").eq("user_id", operation.user_id).maybeSingle().throwOnError();
      if (!member?.activated_at || !["admin", "operator", "bd_manager"].includes(member.role)) throw new Error("The sender no longer has permission to send email.");
      const input = emailSendSchema.parse(operation.payload);
      await deliver({ id: operation.user_id, email: null, displayName: member.display_name, role: member.role }, { ...input, scheduleAt: undefined }, true);
      processed++;
    } catch (error) { await updateEmailSend(operation.user_id, operation.id, "failed", undefined, error instanceof Error ? error.message : "Scheduled delivery failed."); }
  }
  return processed;
}
