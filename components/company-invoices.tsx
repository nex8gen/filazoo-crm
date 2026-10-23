import Link from "next/link";
import { listInvoices } from "@/lib/data/invoices";
import { formatMoney, invoiceLabel, invoiceStatus } from "@/lib/invoices";

export async function CompanyInvoices({
  companyId,
  canWrite,
}: {
  companyId: string;
  canWrite: boolean;
}) {
  const result = await listInvoices(0, "", "", companyId);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section className="mb-7 space-y-4 rounded-xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Customer billing & invoices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.count} invoices linked to this CRM customer.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={`/invoices?companyId=${companyId}`}
            className="rounded-lg border px-3 py-2 hover:bg-muted"
          >
            View invoice history
          </Link>
          {canWrite ? (
            <Link
              href={`/invoices/new?companyId=${companyId}`}
              className="rounded-lg bg-primary px-3 py-2 text-primary-foreground"
            >
              Create customer invoice
            </Link>
          ) : null}
        </div>
      </div>
      {result.summary.length ? (
        <div className="flex flex-wrap gap-3">
          {result.summary.map((row) => (
            <div
              key={row.currency}
              className="rounded-lg bg-muted/40 p-3 text-sm"
            >
              <p className="font-medium">
                {row.currency} ·{" "}
                {formatMoney(row.outstanding_minor, row.currency)} outstanding
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatMoney(row.paid_minor, row.currency)} received ·{" "}
                {formatMoney(row.overdue_minor, row.currency)} overdue
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {result.invoices.length ? (
        <ul className="divide-y">
          {result.invoices.slice(0, 5).map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-wrap justify-between gap-3 py-3 text-sm"
            >
              <Link
                href={`/invoices/${invoice.id}`}
                className="font-medium text-primary underline"
              >
                {invoiceLabel(invoice)}
              </Link>
              <span className="capitalize text-muted-foreground">
                {invoiceStatus(invoice, today)} · due {invoice.document.dueDate}
              </span>
              <span>
                {formatMoney(invoice.total_minor, invoice.document.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Create the first invoice using this customer’s billing details and
          contacts.
        </p>
      )}
    </section>
  );
}
