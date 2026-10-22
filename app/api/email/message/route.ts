import { requireWorkspaceMember } from "@/lib/auth";
import { getEffectiveMailbox, mailboxHasImap } from "@/lib/data/mailboxes";
import { mailboxSyncKey, loadMailboxMessageContent } from "@/lib/data/mailbox-sync";

export const maxDuration = 240;

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const uid = Number(params.get("uid"));
  const uidValidity = Number(params.get("validity"));
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(uidValidity) || uidValidity < 1) return Response.json({ error: "Invalid message identifier." }, { status: 400 });
  const mailbox = await getEffectiveMailbox(viewer.id);
  if (!mailbox || !mailboxHasImap(mailbox) || params.get("mailbox") !== mailboxSyncKey(mailbox)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
  try {
    const email = await loadMailboxMessageContent(mailbox, uid, uidValidity);
    return Response.json({ email }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to open this email." }, { status: 502 });
  }
}
