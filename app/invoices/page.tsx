import { requireWorkspaceMember } from "@/lib/auth";
import { listInvoices } from "@/lib/data/invoices";
import { InvoiceWorkspace } from "@/components/invoice-workspace";

export const metadata = { title: "Invoices" };
export default async function InvoicesPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  let initial;
  let error = "";
  try {
    initial = await listInvoices();
  } catch {
    error =
      "Unable to load invoices. Check the database setup and try refreshing.";
  }
  return (
    <InvoiceWorkspace
      initial={initial ?? { invoices: [], count: 0 }}
      initialError={error}
      canWrite={viewer.role !== "viewer"}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
