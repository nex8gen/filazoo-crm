import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { after } from "next/server";
import { getEffectiveMailbox, mailboxHasImap } from "@/lib/data/mailboxes";
import { loadSyncedMailbox } from "@/lib/data/mailbox-sync";

export const maxDuration = 240;

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const history = new URL(request.url).searchParams.get("scope") === "history";
  const data = await getEmailInboxBackendData({ syncMailbox: false });
  // Return saved mail immediately. Provider login and importing older mail
  // continue after the response, with a shared lease across server instances.
  after(async () => {
    try {
      const mailbox = await getEffectiveMailbox(viewer.id);
      if (mailbox && mailboxHasImap(mailbox)) await loadSyncedMailbox(mailbox, { history });
    } catch (error) {
      console.warn("Mailbox background refresh failed:", error instanceof Error ? error.message : "Unknown error");
    }
  });

  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
    status: 200,
  });
}
