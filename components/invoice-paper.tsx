import { BrandMark } from "@/components/brand-mark";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { invoiceBankFields } from "@/lib/invoice-banks";
import { paymentMethodDetails, paymentMethodTitle } from "@/lib/invoice-payment-methods";
import { PaymentMethodIcon } from "@/components/payment-method-icon";
import {
  formatMoney,
  invoiceLabel,
  invoiceStatus,
  invoiceTotals,
  type Invoice,
} from "@/lib/invoices";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

function invoiceDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

export function InvoicePaper({ invoice, today, customerView = false }: { invoice: Invoice; today: string; customerView?: boolean }) {
  const doc = invoice.document;
  const totals = invoiceTotals(doc);
  const money = (value: number) => formatMoney(value, doc.currency);
  const status = invoiceStatus(invoice, today);
  const balanceDue = invoice.status === "void" ? 0 : totals.total - invoice.paid_minor;
  // Keep printed QR codes reachable from phones, including PDFs made in local development.
  const invoiceUrl = invoice.customer_portal_url;

  return (
    <article className="invoice-paper" lang="en" translate="no" data-no-translate aria-label={`${invoiceLabel(invoice)} invoice`}>
      <header className="invoice-paper-header">
        <div className="invoice-paper-heading">
          <h2>{invoiceLabel(invoice)}</h2>
          <span className="invoice-paper-status">{status === "issued" ? "Issued invoice" : status}</span>
        </div>
        <div className="invoice-paper-brand">
        <BrandMark
          viewBox="20 18 284 62"
          className="invoice-paper-logo"
          style={{ width: 115, height: 25 }}
          role="img"
          aria-label="Filazoo"
          aria-hidden={false}
        />
        </div>
      </header>

      <div className="invoice-paper-intro">
        <section className="invoice-paper-seller" aria-label="Seller">
          <h3>Bill from</h3>
          <p className="invoice-paper-name">{doc.sellerName}</p>
          <p className="invoice-paper-address">{doc.sellerAddress}</p>
          {doc.sellerTaxId ? <p>Tax ID: {doc.sellerTaxId}</p> : null}
        </section>
        <dl className="invoice-paper-meta">
        <div><dt>Invoice number</dt><dd>{invoiceLabel(invoice)}</dd></div>
        <div><dt>Date issued</dt><dd>{invoiceDate(doc.issueDate)}</dd></div>
        <div><dt>Date due</dt><dd>{invoiceDate(doc.dueDate)}</dd></div>
        <div><dt>Currency</dt><dd>{doc.currency}</dd></div>
        {doc.reference ? <div><dt>Reference / PO</dt><dd>{doc.reference}</dd></div> : null}
      </dl>
      </div>

      <div className="invoice-paper-parties">
        <section aria-label="Customer">
          <h3>Bill to</h3>
          <p className="invoice-paper-name">{doc.customerName}</p>
          {doc.customerEmail ? <p>{doc.customerEmail}</p> : null}
          <p className="invoice-paper-address">{doc.customerAddress}</p>
          {doc.customerTaxId ? <p>Tax ID: {doc.customerTaxId}</p> : null}
          {doc.shippingAddress ? <div className="mt-4"><h3>Ship to</h3>{doc.shippingRecipient ? <p>{doc.shippingRecipient}</p> : null}<p className="invoice-paper-address">{doc.shippingAddress}</p>{doc.shippingPhone ? <p>{doc.shippingPhone}</p> : null}</div> : null}
        </section>
        {!customerView && invoiceUrl ? <figure className="invoice-paper-qr">
          <a href={invoiceUrl} aria-label={`Open customer portal for ${invoiceLabel(invoice)}`}>
            <QRCodeSVG
              value={invoiceUrl}
              size={132}
              marginSize={4}
              level="M"
              title={`Open invoice ${invoiceLabel(invoice)}`}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </a>
          <figcaption>Scan for your customer portal<span>{invoice.status === "draft" ? "Activates when invoice is issued" : "Invoice · Tracking · Chat"}</span></figcaption>
        </figure> : null}
      </div>

      <div className="invoice-paper-items" role="region" aria-label="Invoice items" tabIndex={0}>
        <table>
          <caption>All amounts in {doc.currency}. Line amounts are before tax and discount.</caption>
          <thead>
            <tr>
              <th scope="col">No.</th>
              <th scope="col">Description</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price</th>
              <th scope="col">Tax</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item, index) => (
              <tr key={index}>
                <td>{String(index + 1).padStart(2, "0")}</td>
                <td>
                  <div className="invoice-paper-product">
                    {item.imageUrl ? (
                      <Image
                        className="invoice-paper-product-image"
                        src={item.imageUrl}
                        alt={item.description}
                        width={52}
                        height={52}
                        unoptimized
                      />
                    ) : null}
                    <span>
                      <span className="invoice-paper-description">{item.description}</span>
                      {item.variantSku || item.productSku ? (
                        <span className="invoice-paper-sku">SKU: {item.variantSku || item.productSku}</span>
                      ) : null}
                    </span>
                  </div>
                </td>
                <td>{item.quantity}</td>
                <td>{money(item.unitPriceMinor)}</td>
                <td>{item.taxBps / 100}%</td>
                <td>{money(totals.lines[index].gross)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="invoice-paper-settlement">
        <section className="invoice-paper-payment">
          <h3>Payment details</h3>
          {doc.paymentMethods?.map((method) => <div key={method.id} className="invoice-paper-payment-method">
            <h4><PaymentMethodIcon type={method.type} />{paymentMethodTitle(method)}</h4>
            {paymentMethodDetails(method) ? <p>{paymentMethodDetails(method)}</p> : null}
            {method.paymentUrl ? <a href={method.paymentUrl} target="_blank" rel="noreferrer">{method.paymentUrl}</a> : null}
          </div>)}
          {doc.bankAccount ? <dl className="invoice-paper-bank-details">
            {invoiceBankFields(doc.bankAccount, false).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl> : null}
          {doc.paymentInstructions || (!doc.bankAccount && !doc.paymentMethods?.length) ? <p>{doc.paymentInstructions || "Please contact us to confirm payment arrangements."}</p> : null}
          <p className="invoice-paper-payment-reference">Payment reference: <strong>{invoiceLabel(invoice)}</strong></p>
        </section>
        <dl className="invoice-paper-totals">
        <div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
        {doc.discountMinor > 0 ? <div><dt>Discount</dt><dd>−{money(doc.discountMinor)}</dd></div> : null}
        {totals.tax > 0 ? <div><dt>{doc.discountMinor > 0 ? "Tax after discount" : "Tax"}</dt><dd>{money(totals.tax)}</dd></div> : null}
        {doc.shippingMinor > 0 ? <div><dt>Shipping (untaxed)</dt><dd>{money(doc.shippingMinor)}</dd></div> : null}
        <div className="invoice-paper-total"><dt>Total</dt><dd>{money(totals.total)}</dd></div>
        {invoice.paid_minor > 0 ? <div><dt>Payments received</dt><dd>−{money(invoice.paid_minor)}</dd></div> : null}
        <div className="invoice-paper-balance">
          {status === "paid" ? <Image className="invoice-paper-paid-seal" src="/paid-stamp.png" width={110} height={110} unoptimized alt="Paid in full — thank you" /> : null}
          <dt>{invoice.status === "void" ? "Voided balance" : "Amount due"}<span>{doc.currency}</span></dt>
          <dd className={balanceDue > 0 ? "invoice-paper-unpaid" : undefined}>{money(balanceDue)}</dd>
        </div>
      </dl>
      </div>

      <div className="invoice-paper-details">
        <section>
          <h3>{doc.notes ? "Notes & terms" : "Thank you for your business"}</h3>
          <p>{doc.notes || `Please quote ${invoiceLabel(invoice)} when arranging payment or contacting us about this invoice.`}</p>
        </section>
        <section className="invoice-paper-signature" aria-label="Invoice creator signature">
          {invoice.creator_name ? (
            <p className="invoice-paper-autograph">{invoice.creator_name}</p>
          ) : <div className="invoice-paper-signature-missing" />}
          <div />
          <p className="invoice-paper-signatory">Authorised Sales Manager</p>
        </section>
      </div>
    </article>
  );
}
