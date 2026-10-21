import { requireWorkspaceMember } from "@/lib/auth";
import { getEffectiveMailbox, mailboxHasSmtp } from "@/lib/data/mailboxes";
import { sendMailboxEmail } from "@/lib/mailer";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().max(10_000_000),
  contentType: z.string().trim().max(120).optional(),
  cid: z.string().trim().max(255).optional(),
});
const sendSchema = z.object({
  to: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(1).max(300),
  text: z.string().max(1_000_000).default(""),
  html: z.string().max(1_500_000).optional(),
  threadId: z.string().trim().min(1).max(1_100).optional(),
  inReplyTo: z.string().trim().min(1).max(1_000).optional(),
  references: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);

  try {
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "Enter a valid recipient, subject, and message." }, { status: 400 });
    }
    const { to, subject, text, attachments, threadId, inReplyTo, references } = parsed.data;
    const html = parsed.data.html || text;
    const mailbox = await getEffectiveMailbox(viewer.id).catch(() => null);
    if (!mailboxHasSmtp(mailbox) || !mailbox) {
      return Response.json({ ok: false, error: "No valid mailbox is configured. Add SMTP details in Settings first." }, { status: 400 });
    }

    const sendResult = await sendMailboxEmail(
      {
        host: mailbox.smtpHost,
        port: mailbox.smtpPort ?? 587,
        user: mailbox.smtpUsername,
        pass: mailbox.smtpPassword,
        from: mailbox.email,
        secure: (mailbox.smtpPort ?? 587) === 465,
      },
      {
        to,
        subject,
        text: text || "",
        html: html || text || "",
        inReplyTo,
        references,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.from(attachment.content, "base64"),
          contentType: attachment.contentType,
          cid: attachment.cid,
        })),
      },
    );

    const sentAt = new Date().toISOString();
    const { data: saved, error: saveError } = await createSupabaseAdmin().from("mailbox_sent_messages").insert({
      user_id: viewer.id,
      mailbox_id: mailbox.id === "environment-mailbox" ? null : mailbox.id,
      message_id: sendResult.messageId || null,
      from_email: mailbox.email,
      to_email: to,
      subject,
      body: text || html,
      thread_key: threadId || null,
      in_reply_to: inReplyTo || null,
      reference_ids: references,
      status: "sent",
      sent_at: sentAt,
    }).select("id").single();
    if (saveError) console.warn("Email sent, but its CRM record could not be saved:", saveError.message);

    return Response.json({
      ok: true,
      sentVia: mailbox.email,
      saved: !saveError,
      email: {
        id: saved?.id ? `sent-${saved.id}` : `sent-${sendResult.messageId || Date.now()}`,
        from: mailbox.email,
        direction: "outbound",
        status: "Sent",
        subject,
        contact: to,
        company: "Direct email",
        preview: text.replace(/\s+/g, " ").slice(0, 160),
        body: text || html,
        html: parsed.data.html || null,
        threadId: threadId || (inReplyTo ? `message:${inReplyTo.toLowerCase()}` : null),
        messageId: sendResult.messageId || null,
        inReplyTo: inReplyTo || null,
        references,
        timestamp: sentAt,
      },
    }, { status: 200 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send the email.",
    }, { status: 500 });
  }
}
