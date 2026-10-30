import { requireWorkspaceMember } from "@/lib/auth";
import { listInvoices } from "@/lib/data/invoices";
import { InvoiceWorkspace } from "@/components/invoice-workspace";
import { z } from "zod";
import { notFound } from "next/navigation";

export const metadata = { title: "Invoices" };
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string; status?: string }>;
}) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { companyId, status: requestedStatus } = await searchParams;
  const status = ["draft", "issued", "void"].includes(requestedStatus ?? "") ? requestedStatus! : "";
  if (companyId && !z.uuid().safeParse(companyId).success) notFound();
  let initial;
  let error = "";
  try {
    initial = await listInvoices(0, "", status, companyId);
  } catch {
    error =
      "Unable to load invoices. Check the database setup and try refreshing.";
  }
  return (
    <InvoiceWorkspace
      key={`${companyId ?? "all"}:${status}`}
      initialStatus={status}
      initial={initial ?? { invoices: [], count: 0 }}
      initialError={error}
      companyId={companyId}
      canWrite={viewer.role !== "viewer"}
      invoiceViewer={{ id: viewer.id, role: viewer.role }}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
