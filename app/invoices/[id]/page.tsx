import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { getInvoice } from "@/lib/data/invoices";
import { InvoiceWorkspace } from "@/components/invoice-workspace";

export const metadata = { title: "Invoice details" };
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  return (
    <InvoiceWorkspace
      initial={{ invoices: [], count: 0 }}
      initialSelected={invoice}
      initialError=""
      canWrite={viewer.role !== "viewer"}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
