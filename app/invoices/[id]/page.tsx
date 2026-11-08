import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { getInvoice } from "@/lib/data/invoices";
import { LegacyInvoiceDetails } from "@/components/legacy-invoice-details";
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspaceMember(["admin","operator","bd_manager","viewer"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  if (invoice.document.purchaseOrderId) redirect(`/purchase-orders/${invoice.document.purchaseOrderId}`);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return <LegacyInvoiceDetails invoice={invoice} today={today} />;
}
