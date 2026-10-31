import { EmailAccountsWorkspace } from "@/components/email-accounts-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";
import { listCatalogs, listProducts } from "@/lib/data/crm";
import { b2bProducts } from "@/lib/data/b2b-products";
import { canCreateInvoices } from "@/lib/invoice-permissions";
import { getViewerMailbox } from "@/lib/data/mailboxes";
import { notFound } from "next/navigation";

export const metadata = { title: "Email" };

export default async function EmailsPage({ searchParams }: PageProps<"/email">) {
  const params = await searchParams;
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const mailboxId = typeof params.mailbox === "string" ? params.mailbox : undefined;
  if (mailboxId !== undefined && !await getViewerMailbox(viewer.id, mailboxId)) notFound();
  const [data, productResult, catalogResult] = await Promise.all([
    getEmailInboxBackendData({ syncMailbox: false, mailboxId }),
    listProducts().catch(() => ({ products: [] })),
    listCatalogs().catch(() => ({ catalogs: [] })),
  ]);

  return (
    <EmailAccountsWorkspace
      initialData={data}
      canCreateInvoices={canCreateInvoices(viewer.role)}
      invoiceViewer={{ id: viewer.id, role: viewer.role }}
      initialThreadId={typeof params.thread === "string" ? params.thread : undefined}
      initialAgentDraft={typeof params.agentDraft === "string" ? params.agentDraft : undefined}
      products={productResult.products.length ? productResult.products : b2bProducts}
      catalogs={catalogResult.catalogs}
    />
  );
}
