import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { getInvoice } from "@/lib/data/invoices";
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspaceMember(["admin","operator","bd_manager","viewer"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  redirect(invoice.document.purchaseOrderId ? `/purchase-orders/${invoice.document.purchaseOrderId}` : "/purchase-orders");
}
