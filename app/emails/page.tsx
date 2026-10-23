import { EmailInboxWorkspace } from "@/components/email-inbox";
import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { listCatalogs, listProducts } from "@/lib/data/crm";
import { b2bProducts } from "@/lib/data/b2b-products";
import { canCreateInvoices } from "@/lib/invoice-permissions";

export default async function EmailsPage({ searchParams }: PageProps<"/emails">) {
  const params = await searchParams;
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ emails, mailboxConfigured, sendConfigured, inboxConfigured, inboxError, aiConfigured, defaultMailboxEmail, mode, automation }, productResult, catalogResult] = await Promise.all([
    getEmailInboxBackendData({ syncMailbox: false }),
    listProducts().catch(() => ({ products: [] })),
    listCatalogs().catch(() => ({ catalogs: [] })),
  ]);

  return (
    <EmailInboxWorkspace
      canCreateInvoices={canCreateInvoices(viewer.role)}
      invoiceViewer={{ id: viewer.id, role: viewer.role }}
      initialEmails={emails}
      initialThreadId={typeof params.thread === "string" ? params.thread : undefined}
      mailboxConfigured={mailboxConfigured}
      sendConfigured={sendConfigured}
      inboxConfigured={inboxConfigured}
      inboxError={inboxError}
      aiConfigured={aiConfigured}
      defaultMailboxEmail={defaultMailboxEmail}
      dataMode={mode}
      initialAutomation={automation}
      products={productResult.products.length ? productResult.products : b2bProducts}
      catalogs={catalogResult.catalogs}
    />
  );
}
