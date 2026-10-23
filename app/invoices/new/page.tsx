import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { invoiceBootstrap } from "@/lib/data/invoice-connections";
import { InvoiceWorkspace } from "@/components/invoice-workspace";
import { notFound } from "next/navigation";

export const metadata = { title: "New invoice" };
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const input = z
    .object({
      companyId: z.uuid().optional(),
      email: z.email().optional(),
      threadId: z.string().max(1000).optional(),
    })
    .safeParse(await searchParams);
  if (!input.success) notFound();
  const seed = await invoiceBootstrap(input.data);
  return (
    <InvoiceWorkspace
      initial={{ invoices: [], count: 0 }}
      initialEditor={seed.document}
      companyId={seed.document.companyId}
      initialError=""
      canWrite
      invoiceViewer={{ id: viewer.id, role: viewer.role }}
      today={seed.document.issueDate}
    />
  );
}
