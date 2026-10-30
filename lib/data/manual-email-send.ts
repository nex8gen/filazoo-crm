import { requireWorkspaceMember, type WorkspaceViewer } from "@/lib/auth";
import { getViewerMailbox, mailboxHasSmtp } from "@/lib/data/mailboxes";
import { sendMailboxEmail } from "@/lib/mailer";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { referenceHeaderIds, threadKeyForEmail } from "@/lib/email-threading";
import { resolveEmailContentIds } from "@/lib/email-content";
import { prepareUserEmail } from "@/lib/data/email-footers";
import { emailSendSchema } from "../email-workbench";

const attachmentBucket = "mailbox-attachments";

export async function sendEmailRequest(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  return deliverEmail(viewer, await request.json().catch(() => null));
}

export async function deliverEmail(viewer: WorkspaceViewer, input: unknown, alreadyReserved = false) {
  let operationId: string | undefined;
  let smtpStarted = false, smtpAccepted = false;
  try {
    const parsed = emailSendSchema.safeParse(input);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "Enter a valid recipient, subject, and message." }, { status: 400 });
    }
    const { to, cc, bcc, subject, attachments } = parsed.data;
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
    if (parsed.data.providerDraft) {
      const [{ getViewerMailboxes }, { mailboxSyncKey, savedProviderFolders }] = await Promise.all([import("@/lib/data/mailboxes"), import("@/lib/data/mailbox-sync")]);
      const source = parsed.data.providerDraft;
      const sourceMailbox = (await getViewerMailboxes(viewer.id)).find((item) => mailboxSyncKey(item, source.folder) === source.mailboxKey);
      if (!sourceMailbox || !(await savedProviderFolders(sourceMailbox)).some((folder) => folder.path === source.folder && folder.kind === "drafts")) return Response.json({ ok: false, error: "The original draft mailbox is unavailable." }, { status: 404 });
    }
    if (parsed.data.requestId) {
      const { reserveEmailSend } = await import("@/lib/data/email-delivery");
      if (!alreadyReserved) {
        const reservation = await reserveEmailSend(viewer, parsed.data);
        if (reservation.scheduled) return Response.json({ ok: true, scheduled: true, id: parsed.data.requestId, scheduleAt: parsed.data.scheduleAt });
        if (!reservation.reserved) {
          operationId = undefined;
          if (reservation.operation?.status === "sent" && reservation.operation.result) return Response.json(reservation.operation.result);
          return Response.json({ ok: false, error: "This email was already submitted. Check Sent before trying again; its delivery may still be in progress.", deliveryStatus: reservation.operation?.status }, { status: 409 });
        }
      }
      operationId = parsed.data.requestId;
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
        for (const recipient of to) await stopAutoReplyForManualSend(viewer, [...references, ...(inReplyTo ? [inReplyTo] : [])], recipient);
      }
      if (operationId) {
        const { updateEmailSend } = await import("@/lib/data/email-delivery");
        await updateEmailSend(viewer.id, operationId, "submitting");
      }
      smtpStarted = true;
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
        cc,
        bcc,
        ...(operationId ? { messageId: `<${viewer.id}.${operationId}@filazoo.com>` } : {}),
        subject,
        text: text || "",
        html,
        inReplyTo,
        references,
        attachments: decodedAttachments,
      },
    );
    smtpAccepted = true;
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
      to_email: to[0],
      to_recipients: to.map((address) => ({ address })),
      cc_recipients: cc.map((address) => ({ address })),
      bcc_recipients: bcc.map((address) => ({ address })),
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

    const result = {
      ok: true,
      providerWarning: null as string | null,
      sentVia: mailbox.email,
      saved: !saveError,
      email: {
        id: saved?.id ? `sent-${saved.id}` : `sent-${sendResult.messageId || Date.now()}`,
        from: mailbox.email,
        direction: "outbound",
        mailboxId: mailbox.id,
        status: "Sent",
        subject,
        contact: to[0],
        to: to.map((address) => ({ address })),
        cc: cc.map((address) => ({ address })),
        bcc: bcc.map((address) => ({ address })),
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
    };
    if (operationId) {
      const { updateEmailSend } = await import("@/lib/data/email-delivery");
      await updateEmailSend(viewer.id, operationId, "sent", result);
    }
    if (mailbox.imapHost && mailbox.imapUsername && mailbox.imapPassword && sendResult.messageId) {
      try {
        const [{ buildMailboxMime }, { appendMailboxSent }] = await Promise.all([import("@/lib/mailer"), import("@/lib/mailbox-imap")]);
        const raw = await buildMailboxMime(mailbox.email!, { to, cc, bcc, subject, text, html, messageId: sendResult.messageId, inReplyTo, references, attachments: decodedAttachments });
        await appendMailboxSent(mailbox, raw, sendResult.messageId);
      } catch (error) { result.providerWarning = "Email sent and saved in the CRM. Its provider Sent copy could not be saved; check your provider before sending again."; console.warn("Email sent; provider Sent copy failed:", error instanceof Error ? error.message : "Unknown error"); }
    }
    if (parsed.data.draftId) await admin.from("email_workbench_drafts").update({ deleted_at: sentAt, revision: Date.now() * 1000 }).eq("user_id", viewer.id).eq("id", parsed.data.draftId);
    if (parsed.data.providerDraft) {
      try {
        const { syncProviderState } = await import("@/lib/data/email-provider-state");
        await syncProviderState(viewer, "", { ...parsed.data.providerDraft, destination: "trash" });
      } catch { result.providerWarning = "Email sent. The original provider draft could not be removed; review Drafts in your provider."; }
      if (operationId) { const { updateEmailSend } = await import("@/lib/data/email-delivery"); await updateEmailSend(viewer.id, operationId, "sent", result); }
    }
    if (operationId && result.providerWarning) { const { updateEmailSend } = await import("@/lib/data/email-delivery"); await updateEmailSend(viewer.id, operationId, "sent", result); }
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (operationId) {
      try {
        const { updateEmailSend } = await import("@/lib/data/email-delivery");
        await updateEmailSend(viewer.id, operationId, smtpStarted ? "uncertain" : "failed", undefined, error instanceof Error ? error.message : "Delivery failed.");
      } catch { /* Keep the durable reservation; never retry an ambiguous send. */ }
    }
    return Response.json({
      ok: false,
      error: smtpAccepted ? "SMTP accepted this email, but saving its delivery result failed. Check Sent before sending again." : smtpStarted ? "Delivery could not be confirmed. Check Sent before sending again." : error instanceof Error ? error.message : "Unable to send the email.",
    }, { status: 500 });
  }
}
