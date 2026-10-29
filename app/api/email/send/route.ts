import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailbox, mailboxHasSmtp } from "@/lib/data/mailboxes";
import { sendMailboxEmail } from "@/lib/mailer";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { referenceHeaderIds, threadKeyForEmail } from "@/lib/email-threading";
import { resolveEmailContentIds } from "@/lib/email-content";
import { prepareUserEmail } from "@/lib/data/email-footers";
import { z } from "zod";

const attachmentBucket = "mailbox-attachments";

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().max(10_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/, "Invalid attachment content."),
  contentType: z.string().trim().max(120).optional(),
  cid: z.string().trim().max(255).optional(),
});
const sendSchema = z.object({
  mailboxId: z.string().trim().min(1).max(200).optional(),
  to: z.string().trim().toLowerCase().email(),
  subject: z.string().trim().min(1).max(300),
  text: z.string().max(1_000_000).default(""),
  html: z.string().max(1_500_000).optional(),
  footerIncluded: z.boolean().default(false),
  threadId: z.string().trim().min(1).max(1_100).optional(),
  inReplyTo: z.string().trim().max(1_000).regex(/^<[^<>\s]+>$/).optional(),
  references: z.array(z.string().trim().max(1_000).regex(/^<[^<>\s]+>$/)).max(100).default([]),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);

  try {
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ ok: false, error: "Enter a valid recipient, subject, and message." }, { status: 400 });
    }
    const { to, subject, attachments } = parsed.data;
    const inReplyTo = parsed.data.inReplyTo;
    const references = referenceHeaderIds(parsed.data.references);
    const threadId = parsed.data.threadId;
    if (!parsed.data.text.trim() && !parsed.data.html?.trim()) {
      return Response.json({ ok: false, error: "Enter a message before sending." }, { status: 400 });
    }
    if (/\battach(?:ed|ing)?\b[^.!?\n]{0,80}\bcatalog\b|\bcatalog\b[^.!?\n]{0,80}\battach(?:ed|ing)?\b/i.test(parsed.data.text) && !attachments.some((attachment) => attachment.contentType === "application/pdf")) {
      return Response.json({ ok: false, error: "This message says a catalog is attached. Add the catalog PDF before sending." }, { status: 400 });
    }
    const message = await prepareUserEmail(viewer.id, { text: parsed.data.text, html: parsed.data.html, attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType || "application/octet-stream",
      content: Buffer.from(attachment.content, "base64"),
      cid: attachment.cid,
    })) }, parsed.data.footerIncluded);
    const { text, html } = message;
    const decodedAttachments = message.attachments;
    if (decodedAttachments.some((attachment) => attachment.content.length > 7_500_000)) {
      return Response.json({ ok: false, error: "Each attachment must be 7.5 MB or smaller." }, { status: 400 });
    }
    const mailbox = await getViewerMailbox(viewer.id, parsed.data.mailboxId);
    if (!mailboxHasSmtp(mailbox) || !mailbox) {
      return Response.json({ ok: false, error: "No valid mailbox is configured. Add SMTP details in Settings first." }, { status: 400 });
    }

    const admin = createSupabaseAdmin();
    const sentRecordId = crypto.randomUUID();
    const storedAttachments: Array<{ filename: string; contentType: string; size: number; path: string; cid?: string }> = [];
    try {
      for (const [index, attachment] of decodedAttachments.entries()) {
        const path = `${viewer.id}/${sentRecordId}/${index}`;
        const { error } = await admin.storage.from(attachmentBucket).upload(path, attachment.content, {
          contentType: attachment.contentType,
          upsert: false,
        });
        if (error) throw new Error(`Could not store ${attachment.filename}: ${error.message}`);
        storedAttachments.push({ filename: attachment.filename, contentType: attachment.contentType, size: attachment.content.length, path, ...(attachment.cid ? { cid: attachment.cid } : {}) });
      }
    } catch (error) {
      if (storedAttachments.length) await admin.storage.from(attachmentBucket).remove(storedAttachments.map((attachment) => attachment.path));
      throw error;
    }

    let sendResult;
    try {
      if (inReplyTo || references.length) {
        const { stopAutoReplyForManualSend } = await import("@/lib/data/email-auto-reply");
        await stopAutoReplyForManualSend(viewer, [...references, ...(inReplyTo ? [inReplyTo] : [])], to);
      }
      sendResult = await sendMailboxEmail(
      {
        host: mailbox.smtpHost,
        port: mailbox.smtpPort ?? 587,
        user: mailbox.smtpUsername,
        pass: mailbox.smtpPassword,
        from: mailbox.email,
        secure: [465, 994].includes(mailbox.smtpPort ?? 587),
      },
      {
        to,
        subject,
        text: text || "",
        html,
        inReplyTo,
        references,
        attachments: decodedAttachments,
      },
    );
    } catch (error) {
      if (storedAttachments.length) await admin.storage.from(attachmentBucket).remove(storedAttachments.map((attachment) => attachment.path));
      throw error;
    }

    const sentAt = new Date().toISOString();
    const threadKey = threadId || threadKeyForEmail({ id: sentRecordId, messageId: sendResult.messageId, inReplyTo, references });
    const { data: saved, error: saveError } = await admin.from("mailbox_sent_messages").insert({
      id: sentRecordId,
      user_id: viewer.id,
      mailbox_id: mailbox.id === "environment-mailbox" ? null : mailbox.id,
      message_id: sendResult.messageId || null,
      from_email: mailbox.email,
      to_email: to,
      subject,
      body: text,
      body_html: html || null,
      thread_key: threadKey,
      in_reply_to: inReplyTo || null,
      reference_ids: references,
      status: "sent",
      sent_at: sentAt,
      attachments: storedAttachments,
    }).select("id").single();
    if (saveError) console.warn("Email sent, but its CRM record could not be saved:", saveError.message);
    if (saveError && storedAttachments.length) await admin.storage.from(attachmentBucket).remove(storedAttachments.map((attachment) => attachment.path));

    return Response.json({
      ok: true,
      sentVia: mailbox.email,
      saved: !saveError,
      email: {
        id: saved?.id ? `sent-${saved.id}` : `sent-${sendResult.messageId || Date.now()}`,
        from: mailbox.email,
        direction: "outbound",
        mailboxId: mailbox.id,
        status: "Sent",
        subject,
        contact: to,
        company: "Direct email",
        preview: text.replace(/\s+/g, " ").slice(0, 160),
        body: text,
        html: html ? resolveEmailContentIds(html, storedAttachments.map((attachment, index) => ({ cid: attachment.cid, url: saved?.id ? `/api/email/attachments/${saved.id}/${index}` : undefined }))) : null,
        threadId: threadKey,
        messageId: sendResult.messageId || null,
        inReplyTo: inReplyTo || null,
        references,
        attachments: storedAttachments.map(({ filename, contentType, size, cid }, index) => ({
          filename,
          contentType,
          size,
          cid,
          url: saved?.id ? `/api/email/attachments/${saved.id}/${index}` : undefined,
        })),
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
