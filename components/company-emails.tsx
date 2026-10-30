import { EmailInboxWorkspace } from "@/components/email-inbox";
import { getCompanyEmailBackendData } from "@/lib/data/company-emails";
import { filterCompanyEmails, type CompanyEmailScope } from "@/lib/company-email";
import { listCatalogs, listProducts } from "@/lib/data/crm";
import { b2bProducts } from "@/lib/data/b2b-products";
import { canCreateInvoices } from "@/lib/invoice-permissions";

export async function CompanyEmails({ company, viewer, composeTo }: { company: CompanyEmailScope; viewer: { id: string; role: string }; composeTo?: string }) {
  const [data, productResult, catalogResult] = await Promise.all([
    getCompanyEmailBackendData(company),
    listProducts().catch(() => ({ products: [] })),
    listCatalogs().catch(() => ({ catalogs: [] })),
  ]);

  return <div className="space-y-3">
    {!company.emails.some((email) => email.trim()) ? <p className="text-sm text-muted-foreground">Add a contact email in the company profile to see this customer&apos;s messages.</p> : null}
    <EmailInboxWorkspace
      mailboxes={data.mailboxes}
      selectedMailboxId={data.selectedMailboxId}
      defaultSenderId={data.defaultSenderId}
      mailboxConfigured={data.mailboxConfigured}
      sendConfigured={data.sendConfigured}
      inboxConfigured={data.inboxConfigured}
      inboxError={data.inboxError}
      lastMailboxSync={data.lastMailboxSync}
      syncHealth={data.syncHealth}
      aiConfigured={data.aiConfigured}
      defaultMailboxEmail={data.defaultMailboxEmail}
      initialEmails={filterCompanyEmails(data.emails, company)}
      initialComposeTo={composeTo}
      dataMode={data.mode}
      initialAutomation={data.automation}
      companyScope={company}
      canCreateInvoices={canCreateInvoices(viewer.role)}
      invoiceViewer={viewer}
      products={productResult.products.length ? productResult.products : b2bProducts}
      catalogs={catalogResult.catalogs}
    />
  </div>;
}
