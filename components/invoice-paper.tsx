import {
  formatMoney,
  invoiceLabel,
  invoiceStatus,
  invoiceTotals,
  type Invoice,
} from "@/lib/invoices";

export function InvoicePaper({
  invoice,
  today,
}: {
  invoice: Invoice;
  today: string;
}) {
  const doc = invoice.document;
  const totals = invoiceTotals(doc);
  const money = (value: number) => formatMoney(value, doc.currency);
  return (
    <article className="invoice-paper rounded-xl border bg-background p-5 sm:p-10">
      <div className="flex flex-wrap justify-between gap-6 border-b pb-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {invoice.status === "draft" ? "Draft invoice" : "Invoice"}
          </p>
          <h2 className="mt-2 text-3xl font-semibold">
            {invoiceLabel(invoice)}
          </h2>
          <p className="mt-2 text-sm capitalize text-muted-foreground">
            {invoiceStatus(invoice, today)}
          </p>
        </div>
        <div className="text-sm">
          <p className="font-semibold">{doc.sellerName}</p>
          <p className="mt-2 whitespace-pre-line text-muted-foreground">
            {doc.sellerAddress}
          </p>
          {doc.sellerTaxId ? (
            <p className="mt-2">Tax ID: {doc.sellerTaxId}</p>
          ) : null}
        </div>
      </div>
      <div className="my-7 grid gap-6 sm:grid-cols-2">
        <div className="text-sm">
          <p className="mb-2 text-xs uppercase text-muted-foreground">
            Bill to
          </p>
          <p className="font-semibold">{doc.customerName}</p>
          <p>{doc.customerEmail}</p>
          <p className="whitespace-pre-line text-muted-foreground">
            {doc.customerAddress}
          </p>
          {doc.customerTaxId ? <p>Tax ID: {doc.customerTaxId}</p> : null}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Issued</dt>
          <dd>{doc.issueDate}</dd>
          <dt className="text-muted-foreground">Due</dt>
          <dd>{doc.dueDate}</dd>
          <dt className="text-muted-foreground">Currency</dt>
          <dd>{doc.currency}</dd>
          {doc.reference ? (
            <>
              <dt className="text-muted-foreground">Reference / PO</dt>
              <dd className="break-words">{doc.reference}</dd>
            </>
          ) : null}
        </dl>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Description</th>
              <th className="p-3 text-right">Qty</th>
              <th className="p-3 text-right">Unit price</th>
              <th className="p-3 text-right">Tax</th>
              <th className="p-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item, index) => (
              <tr key={index} className="border-b">
                <td className="max-w-64 whitespace-pre-wrap break-words p-3">
                  {item.description}
                </td>
                <td className="p-3 text-right">{item.quantity}</td>
                <td className="whitespace-nowrap p-3 text-right">
                  {money(item.unitPriceMinor)}
                </td>
                <td className="p-3 text-right">{item.taxBps / 100}%</td>
                <td className="whitespace-nowrap p-3 text-right">
                  {money(totals.lines[index].gross)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-6 grid max-w-sm grid-cols-2 gap-3 text-sm">
        <dt>Subtotal</dt>
        <dd className="text-right">{money(totals.subtotal)}</dd>
        <dt>Discount</dt>
        <dd className="text-right">−{money(doc.discountMinor)}</dd>
        <dt>Tax after discount</dt>
        <dd className="text-right">{money(totals.tax)}</dd>
        <dt>Shipping (untaxed)</dt>
        <dd className="text-right">{money(doc.shippingMinor)}</dd>
        <dt className="border-t pt-3 font-semibold">Total</dt>
        <dd className="border-t pt-3 text-right font-semibold">
          {money(totals.total)}
        </dd>
        <dt>Payments</dt>
        <dd className="text-right">{money(invoice.paid_minor)}</dd>
        <dt className="font-semibold">
          {invoice.status === "void" ? "Voided balance" : "Balance due"}
        </dt>
        <dd className="text-right text-lg font-semibold">
          {money(
            invoice.status === "void" ? 0 : totals.total - invoice.paid_minor,
          )}
        </dd>
      </dl>
      {doc.paymentInstructions ? (
        <div className="mt-8 border-t pt-5 text-sm">
          <h3 className="font-semibold">Payment instructions</h3>
          <p className="mt-2 whitespace-pre-line text-muted-foreground">
            {doc.paymentInstructions}
          </p>
        </div>
      ) : null}
      {doc.notes ? (
        <div className="mt-6 text-sm">
          <h3 className="font-semibold">Notes & terms</h3>
          <p className="mt-2 whitespace-pre-line text-muted-foreground">
            {doc.notes}
          </p>
        </div>
      ) : null}
    </article>
  );
}
