import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { AutomationFlowStep, InboxEmailItem } from "../email-inbox.ts";

export type EmailCategory = "Needs follow-up" | "Waiting on customer" | "Interested" | "Big order" | "No action";
export type EmailFolderState = "inbox" | "archive" | "trash";

export type EmailInboxState = {
  messageKey: string;
  category: EmailCategory | null;
  starred: boolean;
  read: boolean;
  folder: EmailFolderState;
  followUpAt: string | null;
};

const defaultSteps: AutomationFlowStep[] = [
  { id: "wait-2d", title: "Wait 2 days", delay: "2 days", action: "Hold the conversation and watch for more buyer intent.", enabled: true },
  { id: "send-reminder", title: "Send helpful reminder", delay: "1 day after wait", action: "Share the relevant catalog or itemized quote.", enabled: true },
  { id: "create-task", title: "Create CRM task", delay: "same day", action: "Assign a follow-up task to the owner and log the intent.", enabled: true },
];

export async function listEmailInboxStates(userId: string): Promise<Map<string, EmailInboxState>> {
  const { data, error } = await createSupabaseAdmin()
    .from("email_inbox_state")
    .select("message_key,category,starred,is_read,folder,follow_up_at")
    .eq("user_id", userId);
  if (error) throw new Error(`Unable to load email state: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.message_key, {
    messageKey: row.message_key,
    category: row.category as EmailCategory | null,
    starred: Boolean(row.starred),
    read: Boolean(row.is_read),
    folder: row.folder as EmailFolderState,
    followUpAt: row.follow_up_at,
  }]));
}

export async function saveEmailInboxState(userId: string, state: EmailInboxState) {
  const admin = createSupabaseAdmin();
  const { data: previous } = await admin.from("email_inbox_state").select("category").eq("user_id", userId).eq("message_key", state.messageKey).maybeSingle();
  const { error } = await admin.from("email_inbox_state").upsert({
    user_id: userId,
    message_key: state.messageKey,
    category: state.category,
    starred: state.starred,
    is_read: state.read,
    folder: state.folder,
    follow_up_at: state.followUpAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,message_key" });
  if (error) throw new Error(`Unable to save email state: ${error.message}`);
  return { categoryChanged: previous?.category !== state.category, previousCategory: previous?.category ?? null };
}

export async function getEmailAutomationSettings(userId: string, queueCount: number) {
  const { data, error } = await createSupabaseAdmin()
    .from("email_automation_settings")
    .select("enabled,steps")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Unable to load email automation: ${error.message}`);
  return {
    enabled: Boolean(data?.enabled),
    queueCount,
    steps: Array.isArray(data?.steps) && data.steps.length ? data.steps as unknown as AutomationFlowStep[] : defaultSteps,
  };
}

export async function saveEmailAutomationSettings(userId: string, enabled: boolean, steps: AutomationFlowStep[]) {
  const { error } = await createSupabaseAdmin().from("email_automation_settings").upsert({
    user_id: userId,
    enabled,
    steps,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw new Error(`Unable to save email automation: ${error.message}`);
  return { enabled, steps };
}

export async function listSentMailboxMessages(userId: string, mailboxId?: string): Promise<InboxEmailItem[]> {
  let query = createSupabaseAdmin()
    .from("mailbox_sent_messages")
    .select("id,mailbox_id,from_email,to_email,subject,body,status,sent_at,message_id,thread_key,in_reply_to,reference_ids,attachments")
    .eq("user_id", userId);
  if (mailboxId !== undefined) query = query.eq("mailbox_id", mailboxId);
  const { data, error } = await query.order("sent_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Unable to load sent mailbox messages: ${error.message}`);
  return (data ?? []).map((row) => {
    const item: InboxEmailItem = {
      id: `sent-${row.id}`,
      from: row.from_email,
      mailboxId: row.mailbox_id,
      direction: "outbound" as const,
      status: row.status === "sent" ? "Sent" : "Failed",
      subject: row.subject,
      contact: row.to_email,
      company: "Direct email",
      preview: row.body.replace(/\s+/g, " ").slice(0, 160),
      body: row.body,
      timestamp: row.sent_at,
      messageId: row.message_id,
      threadId: row.thread_key,
      inReplyTo: row.in_reply_to,
      references: Array.isArray(row.reference_ids) ? row.reference_ids : [],
      attachments: Array.isArray(row.attachments) ? row.attachments.flatMap((value, index) => {
        if (!value || typeof value !== "object" || typeof value.filename !== "string" || typeof value.contentType !== "string" || typeof value.size !== "number") return [];
        return [{ filename: value.filename, contentType: value.contentType, size: value.size, url: `/api/email/attachments/${row.id}/${index}` }];
      }) : [],
    };
    return item;
  });
}
