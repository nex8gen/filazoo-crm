import { requireWorkspaceMember } from "@/lib/auth";
import { getViewerMailbox, mailboxHasImap } from "@/lib/data/mailboxes";
import { savedProviderFolders, mailboxSyncKey } from "@/lib/data/mailbox-sync";
import { searchMailboxMessages } from "@/lib/mailbox-imap";
import { canViewEmail } from "@/lib/email-access";
import { getAssignedEmailContacts } from "@/lib/data/email-access";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 240;
export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") || "").trim();
  if (query.length < 2 || query.length > 200 || /[\r\n\0]/.test(query)) return Response.json({ error: "Enter between 2 and 200 characters." }, { status: 400 });
  const mailboxId = params.get("mailboxId");
  const mailbox = mailboxId ? await getViewerMailbox(viewer.id, mailboxId) : null;
  if (!mailbox || !mailboxHasImap(mailbox)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
  try {
    const folders = [{ path: "INBOX", kind: "inbox" }, ...(await savedProviderFolders(mailbox)).filter((item) => item.kind !== "inbox")];
    const requested = params.get("folder");
    const selected = requested && requested !== "all" ? folders.filter((item) => item.path === requested || item.kind === requested) : folders.filter((item) => !["spam", "trash"].includes(item.kind));
    if (!selected.length) return Response.json({ emails: [], error: null });
    const assigned = mailbox.type === "personal" ? null : await getAssignedEmailContacts(viewer);
    const emails = new Map();
    const errors: string[] = [];
    const { data: cached } = await createSupabaseAdmin().from("mailbox_message_content").select("mailbox_key,uid_validity,uid").in("mailbox_key", selected.map((folder) => mailboxSyncKey(mailbox, folder.path))).ilike("content->>body", `%${query.replace(/[\\%_]/g, "\\$&")}%`).limit(1000).throwOnError();
    let fallback = false;
    for (const folder of selected) {
      try {
        const key = mailboxSyncKey(mailbox, folder.path);
        const bodyMatches = new Set((cached || []).filter((item) => item.mailbox_key === key).map((item) => `${item.uid_validity}:${item.uid}`));
        const matches = await searchMailboxMessages(mailbox, query, folder.path, folder.kind, bodyMatches, request.signal);
        fallback ||= Boolean(matches.fallback);
        for (const message of matches) if (canViewEmail(viewer, message.contact, assigned, mailbox) && !emails.has(message.id)) emails.set(message.id, { ...message, mailboxId: mailbox.id, mailboxKey: mailboxSyncKey(mailbox, folder.path), providerFolder: folder.path });
      } catch (error) { errors.push(`${folder.path}: ${error instanceof Error ? error.message : "Search unavailable"}`); }
      if (request.signal.aborted) break;
    }
    return Response.json({ emails: [...emails.values()], error: errors.join("; ") || (fallback ? "Provider body search is unavailable. Results include message headers and cached bodies." : null), limited: [...emails.values()].length >= 50 }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Provider search unavailable. Showing loaded messages." }, { status: 502 }); }
}
