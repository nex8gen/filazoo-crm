import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { after } from "next/server";
import { getViewerMailbox, mailboxHasImap } from "@/lib/data/mailboxes";
import { loadSyncedMailbox } from "@/lib/data/mailbox-sync";
import { getCompanyDetails } from "@/lib/data/crm";
import { filterCompanyEmails } from "@/lib/company-email";

export const maxDuration = 240;

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const history = params.get("scope") === "history";
  const mailboxId = params.get("mailboxId") ?? undefined;
  if (mailboxId !== undefined && !await getViewerMailbox(viewer.id, mailboxId)) return Response.json({ error: "Mailbox unavailable." }, { status: 404 });
  const companyId = params.get("companyId");
  const company = companyId ? (await getCompanyDetails(companyId)).details : null;
  if (companyId && !company) return Response.json({ error: "Company not found." }, { status: 404 });
  const data = await getEmailInboxBackendData({ syncMailbox: false, mailboxId });
  if (company) data.emails = filterCompanyEmails(data.emails, {
    id: company.company.id,
    name: company.company.name,
    emails: [company.company.email, ...company.contacts.map((contact) => contact.email)],
  });
  // Return saved mail immediately. Provider login and importing older mail
  // continue after the response, with a shared lease across server instances.
  after(async () => {
    try {
      const mailbox = await getViewerMailbox(viewer.id, data.selectedMailboxId);
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
