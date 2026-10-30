import { requireWorkspaceMember } from "@/lib/auth";
import { readCrmReceivedEmail } from "@/lib/data/crm-email-content";
import { downloadMailboxAttachment } from "@/lib/mailbox-imap";
import { emailAttachmentHeaders } from "@/lib/email-files";

export const maxDuration = 240;
export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const id = params.get("id") || "", part = params.get("part") || "";
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) || !/^\d+(?:\.\d+)*$/.test(part) || part.length > 100) return new Response("Invalid attachment.", { status: 400 });
  try {
    const result = await readCrmReceivedEmail(viewer, id, { includeContent: false });
    if (!result?.source || !result.email.attachments.some((file) => file.partId === part)) return new Response("Attachment not found.", { status: 404 });
    const { mailbox, folder, uid, validity } = result.source;
    const file = await downloadMailboxAttachment(mailbox, uid, validity, part, folder);
    return new Response(new Uint8Array(file.content), { headers: emailAttachmentHeaders(file.filename, file.contentType, file.content, params.get("download") === "1") });
  } catch { return Response.json({ error: "Attachment unavailable. Please retry." }, { status: 502 }); }
}
