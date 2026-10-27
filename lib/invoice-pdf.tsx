import path from "node:path";
import { readFileSync } from "node:fs";
import { Children, isValidElement, type SVGProps } from "react";
import { Document, Page, Text, View, Link, Image as PdfImage, Svg, Path, G, Defs, ClipPath, Rect, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import { customerPortalUrl } from "./customer-portal-links";
import { BrandMark } from "../components/brand-mark";
import { invoiceBankFields } from "./invoice-banks";
import { paymentMethodDetails, paymentMethodTitle } from "./invoice-payment-methods";
import { PAYPAL_ICON_PATH } from "./payment-icons";
import { formatMoney, invoiceLabel, invoiceStatus, invoiceTotals, type Invoice } from "./invoices";
import { DEFAULT_INVOICE_PRODUCT_IMAGE } from "./invoice-links";

const font = (filename: string) => path.join(process.cwd(), "public", "fonts", filename);
const paidStamp = { data: readFileSync(path.join(process.cwd(), "public", "paid-stamp.png")), format: "png" as const };
const defaultProductImage = {
  data: readFileSync(path.join(process.cwd(), "public", "catalog-default-product.jpg")),
  format: "jpg" as const,
};
Font.register({ family: "Inter", fonts: [
  { src: font("inter-regular.woff"), fontWeight: 400 },
  { src: font("inter-semibold.woff"), fontWeight: 600 },
  { src: font("inter-bold.woff"), fontWeight: 700 },
] });
Font.register({ family: "Invoice Signature", src: font("allison-regular.ttf") });
Font.register({ family: "Invoice CJK", src: font("noto-sans-sc-regular.otf") });
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: { paddingTop: 100, paddingBottom: 38, paddingHorizontal: 36, fontFamily: "Inter", fontSize: 10.5, lineHeight: 1.45, color: "#161616" },
  header: { position: "absolute", top: 34, left: 36, right: 36, borderTopWidth: 2.25, borderTopColor: "#161616", paddingTop: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  number: { fontSize: 24, fontWeight: 600, lineHeight: 1.1 },
  status: { fontSize: 9, marginTop: 5, color: "#494949", textTransform: "capitalize" },
  intro: { flexDirection: "row", justifyContent: "space-between", gap: 28, marginTop: 12 },
  half: { width: "48%" },
  heading: { fontSize: 10.5, fontWeight: 600, marginBottom: 6 },
  billingHeading: { fontSize: 12, fontWeight: 600, marginBottom: 6 },
  name: { fontWeight: 600 },
  muted: { color: "#494949" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 5 },
  metaLabel: { width: "45%", color: "#494949" },
  metaValue: { width: "55%", textAlign: "right" },
  customerRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 20, marginBottom: 20, gap: 28 },
  paidSeal: { position: "absolute", right: 3, top: -36, width: 82.5, height: 82.5, opacity: 0.72 },
  qr: { width: 104, alignItems: "center" },
  qrImage: { width: 99, height: 99 },
  qrLabel: { fontSize: 8.5, textAlign: "center", marginTop: 2 },
  qrHint: { fontSize: 8, textAlign: "center", color: "#494949" },
  row: { flexDirection: "row", paddingVertical: 9, paddingHorizontal: 10, borderBottomWidth: 0.5, borderBottomColor: "#dedede", alignItems: "flex-start" },
  tableHead: { backgroundColor: "#151515", color: "#ffffff", fontWeight: 600, fontSize: 9 },
  serial: { width: "6%" },
  description: { width: "36%", paddingRight: 10, flexDirection: "row", gap: 7 },
  productImage: { width: 34, height: 34, objectFit: "cover", borderWidth: 0.5, borderColor: "#dedede", borderRadius: 2 },
  productCopy: { flex: 1 },
  qty: { width: "9%", textAlign: "right" },
  unit: { width: "17%", textAlign: "right" },
  tax: { width: "11%", textAlign: "right" },
  amount: { width: "21%", textAlign: "right" },
  sku: { fontSize: 9, color: "#494949", marginTop: 3 },
  caption: { fontSize: 9, color: "#494949", marginTop: 7 },
  settlement: { flexDirection: "row", gap: 24, marginTop: 20 },
  bank: { width: "53%" },
  totals: { width: "47%" },
  bankRow: { flexDirection: "row", gap: 6, marginBottom: 6, fontSize: 9.5 },
  bankLabel: { width: 77, fontSize: 9, color: "#494949" },
  bankValue: { flex: 1 },
  instructions: { color: "#494949", fontSize: 9.5, marginTop: 6 },
  paymentReference: { fontSize: 9.5, marginTop: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 7 },
  totalRule: { borderTopWidth: 0.6, borderTopColor: "#dedede", paddingTop: 9, marginTop: 3, fontWeight: 600 },
  balance: { position: "relative", flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, borderTopWidth: 2, borderTopColor: "#bdbdbd", paddingTop: 12, marginTop: 5 },
  balanceValue: { fontSize: 19.5, fontWeight: 600 },
  footer: { marginTop: 20, borderTopWidth: 0.6, borderTopColor: "#dedede", paddingTop: 14, flexDirection: "row", gap: 24 },
  notes: { flex: 1 },
  noteText: { color: "#494949", fontSize: 9.75 },
  signature: { width: 145, alignSelf: "flex-start", textAlign: "center" },
  autograph: { fontFamily: "Invoice Signature", fontSize: 32, lineHeight: 1, marginBottom: -2 },
  signatureTitle: { borderTopWidth: 0.6, borderTopColor: "#999999", paddingTop: 6, fontSize: 9, fontWeight: 700 },
  pagination: { position: "absolute", bottom: 18, left: 36, right: 36, textAlign: "right", color: "#494949", fontSize: 8 },
});

type PdfTextProps = { value: string; style?: (typeof s)[keyof typeof s] };
function ContentText({ value, style }: PdfTextProps) {
  const needsCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  return <Text style={[style || {}, needsCjk ? { fontFamily: "Invoice CJK", fontWeight: 400 } : {}]}>{value}</Text>;
}

function PdfLogo() {
  return <Svg width={86} height={18.8} viewBox="20 18 284 62">
    <Defs><ClipPath id="filazoo-wordmark"><Rect x={20} y={18} width={284} height={62} /></ClipPath></Defs>
    <G clipPath="url(#filazoo-wordmark)">{Children.toArray(BrandMark({}).props.children).map((child, index) =>
      isValidElement<SVGProps<SVGPathElement>>(child) ? <Path key={index} d={child.props.d || ""} fill="#000000" fillRule={child.props.fillRule === "evenodd" ? "evenodd" : "nonzero"} /> : null,
    )}</G>
  </Svg>;
}

function InvoicePdfDocument({ invoice, today, qr }: { invoice: Invoice; today: string; qr: string }) {
  const doc = invoice.document;
  const totals = invoiceTotals(doc);
  const money = (value: number) => formatMoney(value, doc.currency);
  const balance = invoice.status === "void" ? 0 : totals.total - invoice.paid_minor;
  const status = invoiceStatus(invoice, today);
  const rows: [string, string][] = [
    ["Subtotal", money(totals.subtotal)],
    ...(doc.discountMinor ? [["Discount", `−${money(doc.discountMinor)}`] as [string, string]] : []),
    ...(totals.tax ? [[doc.discountMinor ? "Tax after discount" : "Tax", money(totals.tax)] as [string, string]] : []),
    ...(doc.shippingMinor ? [["Shipping (untaxed)", money(doc.shippingMinor)] as [string, string]] : []),
  ];
  return <Document title={`${invoiceLabel(invoice)}${invoice.status === "draft" ? " — Draft" : ""}`} author={doc.sellerName}>
    <Page size="A4" style={s.page} wrap>
      <View fixed style={s.header}><View><Text style={s.number}>{invoiceLabel(invoice)}</Text><Text style={s.status}>{status}</Text></View><PdfLogo /></View>
      <View style={s.intro} wrap={false}>
        <View style={s.half}><Text style={s.billingHeading}>Bill from</Text><ContentText value={doc.sellerName} style={s.name} /><ContentText value={doc.sellerAddress} style={s.muted} />{doc.sellerTaxId ? <ContentText value={`Tax ID: ${doc.sellerTaxId}`} /> : null}</View>
        <View style={s.half}>{[["Invoice number", invoiceLabel(invoice)], ["Date issued", doc.issueDate], ["Date due", doc.dueDate], ["Currency", doc.currency], ...(doc.reference ? [["Reference / PO", doc.reference]] : [])].map(([label, value]) => <View key={label} style={s.metaRow}><Text style={s.metaLabel}>{label}</Text><ContentText value={value} style={s.metaValue} /></View>)}</View>
      </View>
      <View style={s.customerRow} wrap={false}>
        <View style={s.half}><Text style={s.billingHeading}>Bill to</Text><ContentText value={doc.customerName} style={s.name} /><ContentText value={doc.customerEmail} style={s.muted} /><ContentText value={doc.customerAddress} style={s.muted} />{doc.customerTaxId ? <ContentText value={`Tax ID: ${doc.customerTaxId}`} /> : null}
          {doc.shippingAddress ? <View style={{ marginTop: 10 }}><Text style={s.heading}>Ship to</Text>{doc.shippingRecipient ? <ContentText value={doc.shippingRecipient} /> : null}<ContentText value={doc.shippingAddress} style={s.muted} />{doc.shippingPhone ? <ContentText value={doc.shippingPhone} style={s.muted} /> : null}</View> : null}
        </View>
        {qr ? <View style={s.qr}><PdfImage src={qr} style={s.qrImage} /><Text style={s.qrLabel}>Your customer portal</Text><Text style={s.qrHint}>{invoice.status === "draft" ? "Activates when invoice is issued" : "Invoice · Tracking · Chat"}</Text></View> : null}
      </View>
      <View style={[s.row, s.tableHead]} minPresenceAhead={35}><Text style={s.serial}>No.</Text><Text style={s.description}>Description</Text><Text style={s.qty}>Qty</Text><Text style={s.unit}>Unit price</Text><Text style={s.tax}>Tax</Text><Text style={s.amount}>Amount</Text></View>
      {doc.items.map((item, index) => <View key={index} style={[s.row, { backgroundColor: index % 2 ? "#f3f3f3" : "#ffffff" }]} wrap={false}>
        <Text style={s.serial}>{String(index + 1).padStart(2, "0")}</Text><View style={s.description}>{item.imageUrl ? <PdfImage src={item.imageUrl === DEFAULT_INVOICE_PRODUCT_IMAGE ? defaultProductImage : item.imageUrl} style={s.productImage} /> : null}<View style={s.productCopy}><ContentText value={item.description} />{item.variantSku || item.productSku ? <ContentText value={`SKU: ${item.variantSku || item.productSku}`} style={s.sku} /> : null}</View></View><Text style={s.qty}>{item.quantity}</Text><Text style={s.unit}>{money(item.unitPriceMinor)}</Text><Text style={s.tax}>{item.taxBps / 100}%</Text><Text style={s.amount}>{money(totals.lines[index].gross)}</Text>
      </View>)}
      <Text style={s.caption}>All amounts in {doc.currency}. Line amounts are before tax and discount.</Text>
      <View style={s.settlement}>
        <View style={s.bank}><Text style={s.heading}>Payment details</Text>
          {doc.paymentMethods?.map((method) => <View key={method.id} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              {method.type === "paypal" ? <Svg viewBox="0 0 16 16" width={13} height={13}><Path d={PAYPAL_ICON_PATH} fill="#0070ba" /></Svg> : null}
              <ContentText value={paymentMethodTitle(method)} style={s.name} />
            </View>
            {paymentMethodDetails(method) ? <ContentText value={paymentMethodDetails(method)} style={s.instructions} /> : null}
            {method.paymentUrl ? <Link src={method.paymentUrl} style={s.instructions}>{method.paymentUrl}</Link> : null}
          </View>)}
          {doc.bankAccount ? invoiceBankFields(doc.bankAccount, false).map(([label, value]) => <View key={label} style={s.bankRow} wrap={false}><Text style={s.bankLabel}>{label}</Text><ContentText value={value} style={s.bankValue} /></View>) : null}
          {doc.paymentInstructions || (!doc.bankAccount && !doc.paymentMethods?.length) ? <ContentText value={doc.paymentInstructions || "Please contact us to confirm payment arrangements."} style={s.instructions} /> : null}<Text style={s.paymentReference}>Payment reference: {invoiceLabel(invoice)}</Text></View>
        <View style={s.totals} wrap={false}>{rows.map(([label, value]) => <View key={label} style={s.totalRow}><Text style={s.muted}>{label}</Text><Text>{value}</Text></View>)}<View style={[s.totalRow, s.totalRule]}><Text>Total</Text><Text>{money(totals.total)}</Text></View>{invoice.paid_minor ? <View style={s.totalRow}><Text style={s.muted}>Payments received</Text><Text>−{money(invoice.paid_minor)}</Text></View> : null}<View style={s.balance}><View><Text style={s.name}>{invoice.status === "void" ? "Voided balance" : "Amount due"}</Text><Text style={s.sku}>{doc.currency}</Text></View><Text style={[s.balanceValue, { color: balance > 0 ? "#b91c1c" : "#161616" }]}>{money(balance)}</Text>{status === "paid" ? <PdfImage src={paidStamp} style={s.paidSeal} /> : null}</View></View>
      </View>
      <View style={s.footer}>
      <View style={s.notes}><Text style={s.heading}>{doc.notes ? "Notes & terms" : "Thank you for your business"}</Text><ContentText value={doc.notes || `Please quote ${invoiceLabel(invoice)} when arranging payment or contacting us about this invoice.`} style={s.noteText} /></View>
      <View style={s.signature} wrap={false}>{invoice.creator_name ? <ContentText value={invoice.creator_name} style={s.autograph} /> : null}<Text style={s.signatureTitle}>Authorised Sales Manager</Text></View>
      </View>
      <Text fixed style={s.pagination} render={({ pageNumber, totalPages }) => totalPages > 1 ? `${invoiceLabel(invoice)} · ${pageNumber} / ${totalPages}` : ""} />
    </Page>
  </Document>;
}

export async function renderInvoicePdf(invoice: Invoice, today: string) {
  const portalUrl = customerPortalUrl(invoice);
  const qr = portalUrl ? await QRCode.toDataURL(portalUrl, { width: 396, margin: 4, errorCorrectionLevel: "M" }) : "";
  return renderToBuffer(<InvoicePdfDocument invoice={invoice} today={today} qr={qr} />);
}
