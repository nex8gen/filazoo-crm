import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { mailboxSyncKey, loadMailboxMessageContent } from "@/lib/data/mailbox-sync";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { canViewEmail } from "@/lib/email-access";
import { downloadMailboxAttachment } from "@/lib/mailbox-imap";
import { validProviderFolder } from "@/lib/email-provider";
import { emailAttachmentHeaders } from "@/lib/email-files";

export const maxDuration = 240;

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const uid = Number(params.get("uid")), validity = Number(params.get("validity"));
  const part = params.get("part") || "";
  const folder = params.get("folder") || "INBOX";
  if (!validProviderFolder(folder)) return new Response("Invalid folder.", { status: 400 });
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(validity) || validity < 1 || !/^\d+(?:\.\d+)*$/.test(part) || part.length > 100) return new Response("Invalid attachment identifier.", { status: 400 });
  const mailbox = (await getViewerMailboxes(viewer.id)).find((item) => mailboxSyncKey(item, folder) === params.get("mailbox"));
  if (!mailbox || !mailboxHasImap(mailbox)) return new Response("Attachment not found.", { status: 404 });
  try {
    if (viewer.role === "bd_manager" && mailbox.type !== "personal") {
      const email = await loadMailboxMessageContent(mailbox, uid, validity, folder);
      if (!canViewEmail(viewer, email.contact, await getAssignedEmailContacts(viewer), mailbox)) return new Response("Attachment not found.", { status: 404 });
    }
    const attachment = await downloadMailboxAttachment(mailbox, uid, validity, part, folder);
    const content = new Uint8Array(attachment.content);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < content.length; offset += 65536) controller.enqueue(content.subarray(offset, offset + 65536));
        controller.close();
      },
    });
    return new Response(stream, { headers: emailAttachmentHeaders(attachment.filename, attachment.contentType, content, params.get("download") === "1") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Attachment unavailable." }, { status: 502 });
  }
}
