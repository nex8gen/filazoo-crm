import { requireWorkspaceMember } from "@/lib/auth";
import { getEffectiveMailbox, mailboxHasImap } from "@/lib/data/mailboxes";
import { mailboxSyncKey, loadMailboxMessageContent } from "@/lib/data/mailbox-sync";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { canViewEmail } from "@/lib/email-access";
import { downloadMailboxAttachment } from "@/lib/mailbox-imap";

export const maxDuration = 240;

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const uid = Number(params.get("uid")), validity = Number(params.get("validity"));
  const part = params.get("part") || "";
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(validity) || validity < 1 || !/^\d+(?:\.\d+)*$/.test(part) || part.length > 100) return new Response("Invalid attachment identifier.", { status: 400 });
  const mailbox = await getEffectiveMailbox(viewer.id);
  if (!mailbox || !mailboxHasImap(mailbox) || params.get("mailbox") !== mailboxSyncKey(mailbox)) return new Response("Attachment not found.", { status: 404 });
  try {
    if (viewer.role === "bd_manager") {
      const email = await loadMailboxMessageContent(mailbox, uid, validity);
      if (!canViewEmail(viewer, email.contact, await getAssignedEmailContacts(viewer))) return new Response("Attachment not found.", { status: 404 });
    }
    const attachment = await downloadMailboxAttachment(mailbox, uid, validity, part);
    const filename = attachment.filename.replace(/[\r\n"\\]/g, "_");
    const safeInline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(attachment.contentType);
    const content = new Uint8Array(attachment.content);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < content.length; offset += 65536) controller.enqueue(content.subarray(offset, offset + 65536));
        controller.close();
      },
    });
    return new Response(stream, { headers: {
      "Content-Type": safeInline ? attachment.contentType : "application/octet-stream",
      "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Attachment unavailable." }, { status: 502 });
  }
}
