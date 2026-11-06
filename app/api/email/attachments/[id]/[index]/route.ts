import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { canViewEmail } from "@/lib/email-access";
import { getViewerMailbox } from "@/lib/data/mailboxes";
import { emailAttachmentHeaders } from "@/lib/email-files";
import { getCompanyEmailScope } from "@/lib/data/company-email-access";
import { filterCompanyEmails } from "@/lib/company-email";

export async function GET(request: Request, context: RouteContext<"/api/email/attachments/[id]/[index]">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id, index: indexText } = await context.params;
  const index = Number(indexText);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(index) || index < 0 || index > 9) {
    return new Response("Attachment not found.", { status: 404 });
  }

  const admin = createSupabaseAdmin();
  const companyId = new URL(request.url).searchParams.get("companyId");
  const company = companyId ? await getCompanyEmailScope(viewer, companyId) : null;
  if (companyId && !company) return new Response("Attachment not found.", { status: 404 });
  let query = admin.from("mailbox_sent_messages").select("attachments,to_email,to_recipients,cc_recipients,bcc_recipients,mailbox_id,user_id,status").eq("id", id);
  if (!company) query = query.eq("user_id", viewer.id);
  const { data: message, error } = await query.maybeSingle();
  if (error || !message || !Array.isArray(message.attachments)) return new Response("Attachment not found.", { status: 404 });
  if (company && (message.status !== "sent" || !filterCompanyEmails([{ contact: message.to_email,
    to: message.to_recipients, cc: message.cc_recipients, bcc: message.bcc_recipients }], company).length)) return new Response("Attachment not found.", { status: 404 });
  const mailbox = !company && message.mailbox_id ? await getViewerMailbox(viewer.id, message.mailbox_id) : null;
  if (!company && message.mailbox_id && !mailbox) return new Response("Attachment not found.", { status: 404 });
  const assignedContacts = mailbox?.type === "personal" ? null : await getAssignedEmailContacts(viewer);
  if (!company && !canViewEmail(viewer, message.to_email, assignedContacts, mailbox)) return new Response("Attachment not found.", { status: 404 });
  const attachment = message.attachments[index];
  if (!attachment || typeof attachment.path !== "string" || typeof attachment.filename !== "string" || !attachment.path.startsWith(`${message.user_id ?? viewer.id}/${id}/`)) {
    return new Response("Attachment not found.", { status: 404 });
  }

  const { data, error: downloadError } = await admin.storage.from("mailbox-attachments").download(attachment.path);
  if (downloadError || !data) return new Response("Attachment unavailable.", { status: 404 });
  const bytes = new Uint8Array(await data.arrayBuffer());
  return new Response(data, {
    headers: emailAttachmentHeaders(attachment.filename, attachment.contentType, bytes, new URL(request.url).searchParams.get("download") === "1"),
  });
}
