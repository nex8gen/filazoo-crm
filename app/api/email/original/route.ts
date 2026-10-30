import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { loadMailboxMessageContent, mailboxSyncKey } from "@/lib/data/mailbox-sync";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { canViewEmail } from "@/lib/email-access";
import { validProviderFolder } from "@/lib/email-provider";
import { downloadMailboxOriginal } from "@/lib/mailbox-imap";

export const maxDuration = 240;
export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const uid = Number(params.get("uid")), validity = Number(params.get("validity")), folder = params.get("folder") || "INBOX";
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(validity) || validity < 1 || !validProviderFolder(folder)) return new Response("Invalid message.", { status: 400 });
  const mailbox = (await getViewerMailboxes(viewer.id)).find((item) => mailboxSyncKey(item, folder) === params.get("mailbox"));
  if (!mailbox || !mailboxHasImap(mailbox)) return new Response("Email unavailable.", { status: 404 });
  try {
    const email = await loadMailboxMessageContent(mailbox, uid, validity, folder);
    if (!canViewEmail(viewer, email.contact, mailbox.type === "personal" ? null : await getAssignedEmailContacts(viewer), mailbox)) return new Response("Email unavailable.", { status: 404 });
    const bytes = await downloadMailboxOriginal(mailbox, uid, validity, folder);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "message/rfc822", "Content-Disposition": "attachment; filename=message.eml", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Original message unavailable.", { status: 502 }); }
}
