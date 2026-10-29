import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { canViewEmail } from "@/lib/email-access";
import { getViewerMailbox } from "@/lib/data/mailboxes";

export async function GET(_request: Request, context: RouteContext<"/api/email/attachments/[id]/[index]">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id, index: indexText } = await context.params;
  const index = Number(indexText);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(index) || index < 0 || index > 9) {
    return new Response("Attachment not found.", { status: 404 });
  }

  const admin = createSupabaseAdmin();
  const { data: message, error } = await admin.from("mailbox_sent_messages")
    .select("attachments,to_email,mailbox_id").eq("id", id).eq("user_id", viewer.id).maybeSingle();
  if (error || !message || !Array.isArray(message.attachments)) return new Response("Attachment not found.", { status: 404 });
  const mailbox = message.mailbox_id ? await getViewerMailbox(viewer.id, message.mailbox_id) : null;
  if (message.mailbox_id && !mailbox) return new Response("Attachment not found.", { status: 404 });
  const assignedContacts = mailbox?.type === "personal" ? null : await getAssignedEmailContacts(viewer);
  if (!canViewEmail(viewer, message.to_email, assignedContacts, mailbox)) return new Response("Attachment not found.", { status: 404 });
  const attachment = message.attachments[index];
  if (!attachment || typeof attachment.path !== "string" || typeof attachment.filename !== "string" || !attachment.path.startsWith(`${viewer.id}/${id}/`)) {
    return new Response("Attachment not found.", { status: 404 });
  }

  const { data, error: downloadError } = await admin.storage.from("mailbox-attachments").download(attachment.path);
  if (downloadError || !data) return new Response("Attachment unavailable.", { status: 404 });
  const filename = attachment.filename.replace(/[\r\n"\\]/g, "_");
  const fallbackFilename = filename.replace(/[^\x20-\x7e]/g, "_");
  const inlineTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);
  const contentType = inlineTypes.has(attachment.contentType) ? attachment.contentType : "application/octet-stream";
  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${contentType !== "application/octet-stream" ? "inline" : "attachment"}; filename="${fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
