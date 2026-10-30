import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailboxes, mailboxHasImap } from "@/lib/data/mailboxes";
import { mailboxSyncKey, loadMailboxMessageContent } from "@/lib/data/mailbox-sync";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { canViewEmail } from "@/lib/email-access";
import { validProviderFolder } from "@/lib/email-provider";

export const maxDuration = 240;

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const uid = Number(params.get("uid"));
  const uidValidity = Number(params.get("validity"));
  const folder = params.get("folder") || "INBOX";
  if (!validProviderFolder(folder)) return Response.json({ error: "Invalid folder." }, { status: 400 });
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(uidValidity) || uidValidity < 1) return Response.json({ error: "Invalid message identifier." }, { status: 400 });
  const mailbox = (await getViewerMailboxes(viewer.id)).find((item) => mailboxSyncKey(item, folder) === params.get("mailbox"));
  if (!mailbox || !mailboxHasImap(mailbox)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
  try {
    const email = await loadMailboxMessageContent(mailbox, uid, uidValidity, folder);
    const assignedContacts = mailbox.type === "personal" ? null : await getAssignedEmailContacts(viewer);
    if (!canViewEmail(viewer, email.contact, assignedContacts, mailbox)) return Response.json({ error: "Email not found." }, { status: 404 });
    return Response.json({ email }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to open this email." }, { status: 502 });
  }
}
