import { EmailAccountsWorkspace } from "@/components/email-accounts-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { canCreateInvoices } from "@/lib/invoice-permissions";
import { getViewerMailboxes } from "@/lib/data/mailboxes";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { notFound } from "next/navigation";

export const metadata = { title: "Email" };

export default async function EmailsPage({ searchParams }: PageProps<"/email">) {
  const params = await searchParams;
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return withWorkspaceViewer(viewer, async () => {
    const mailboxId = typeof params.mailbox === "string" ? params.mailbox : undefined;
    const mailboxes = await getViewerMailboxes(viewer.id);
    if (mailboxId !== undefined && !mailboxes.some(mailbox => mailbox.id === mailboxId)) notFound();
    const data = await getEmailInboxBackendData({ syncMailbox: false, mailboxId, context: { viewer, mailboxes }, interactive: true });

    return (
      <EmailAccountsWorkspace
        key={`${mailboxId ?? ""}:${typeof params.thread === "string" ? params.thread : ""}:${params.reply === "1"}`}
        initialData={data}
        canCreateInvoices={canCreateInvoices(viewer.role)}
        invoiceViewer={{ id: viewer.id, role: viewer.role }}
        initialThreadId={typeof params.thread === "string" ? params.thread : undefined}
        initialReplyOpen={params.reply === "1" && viewer.role !== "viewer"}
        initialAgentDraft={typeof params.agentDraft === "string" ? params.agentDraft : undefined}
        initialLibraryItem={typeof params.libraryItem === "string" ? params.libraryItem : undefined}
        initialLibraryRequest={typeof params.libraryRequest === "string" ? params.libraryRequest : undefined}
        products={[]}
        catalogs={[]}
        resourcesDeferred
      />
    );
  });
}
