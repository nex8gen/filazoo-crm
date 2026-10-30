import path from "node:path";
import { Document, Page, Text, View, Font, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatMoney } from "./invoices";
import { quotationLabel, quotationState, quotationStatusLabels, type QuotationRecord } from "./quotations";

Font.register({ family: "Quotation Inter", fonts: [
  { src: path.join(process.cwd(), "public/fonts/inter-regular.woff"), fontWeight: 400 },
  { src: path.join(process.cwd(), "public/fonts/inter-semibold.woff"), fontWeight: 600 },
] });
Font.register({ family: "Quotation CJK", src: path.join(process.cwd(), "public/fonts/noto-sans-sc-regular.otf") });
const s = StyleSheet.create({
  page: { paddingTop: 100, paddingBottom: 48, paddingHorizontal: 38, fontFamily: "Quotation Inter", fontSize: 9.5, lineHeight: 1.5, color: "#17232d" },
  header: { position: "absolute", top: 32, left: 38, right: 38, height: 65, borderTopWidth: 3, borderTopColor: "#203c45", paddingTop: 12, flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 23, lineHeight: 1.2, marginBottom: 5, fontWeight: 600 }, muted: { color: "#546570" },
  section: { marginBottom: 18 }, heading: { fontSize: 11, fontWeight: 600, marginBottom: 5 },
  columns: { flexDirection: "row", gap: 28, marginBottom: 20 }, half: { width: "48%" },
  row: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "#d9e1e5" },
  tableHead: { backgroundColor: "#203c45", color: "white", paddingHorizontal: 7 },
  description: { width: "45%", paddingRight: 8 }, quantity: { width: "12%", textAlign: "right" }, unit: { width: "21%", textAlign: "right" }, amount: { width: "22%", textAlign: "right" },
  totals: { marginLeft: "auto", width: "48%", marginTop: 16, marginBottom: 22 }, totalRow: { flexDirection: "row", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  grand: { borderTopWidth: 1, borderTopColor: "#203c45", paddingTop: 8, fontSize: 12, fontWeight: 600 },
  footer: { position: "absolute", left: 38, right: 38, bottom: 22, height: 16, fontSize: 8, color: "#546570", flexDirection: "row", justifyContent: "space-between" },
});
function Copy({ children }: { children: string }) { return <Text style={/[\u2e80-\u9fff]/.test(children) ? { fontFamily: "Quotation CJK" } : undefined}>{children}</Text>; }
export function renderQuotationPdf(catalog: QuotationRecord) {
  const doc = catalog.quote_document;
  if (!doc) throw new Error("Save the quotation before downloading its PDF.");
  const reference = quotationLabel(catalog);
  const money = (value: number) => formatMoney(value, doc.currency);
  return renderToBuffer(<Document title={`${reference} - ${doc.customerName}`} author={doc.sellerName}>
    <Page size="A4" style={s.page} wrap>
      <View style={s.header} fixed><View><Text style={s.title}>QUOTATION</Text><Text>{reference}</Text></View><View><Copy>{doc.sellerName}</Copy><Text style={s.muted}>{quotationStatusLabels[quotationState(catalog)]}</Text></View></View>
      <View style={s.columns}><View style={s.half}><Text style={s.heading}>Prepared for</Text><Copy>{doc.customerName}</Copy><Copy>{doc.billingAddress}</Copy>{doc.customerEmail ? <Copy>{doc.customerEmail}</Copy> : null}{doc.taxId ? <Copy>{`Tax ID: ${doc.taxId}`}</Copy> : null}</View><View style={s.half}><Text>Issue date: {doc.issueDate}</Text><Text>Valid until: {doc.validUntil} (China time)</Text><Text>Currency: {doc.currency}</Text><Copy>{doc.sellerAddress}</Copy></View></View>
      <View style={[s.row, s.tableHead]} fixed><Text style={s.description}>Product / SKU</Text><Text style={s.quantity}>Quantity</Text><Text style={s.unit}>Unit price</Text><Text style={s.amount}>Amount</Text></View>
      {doc.items.map((item, index) => <View key={index} style={s.row} wrap={false}><View style={s.description}><Copy>{item.description}</Copy><Text style={s.muted}>{item.sku}</Text></View><Text style={s.quantity}>{item.quantity.toLocaleString("en")}</Text><Text style={s.unit}>{money(item.unitPriceMinor)}</Text><Text style={s.amount}>{money(item.quantity * item.unitPriceMinor)}</Text></View>)}
      <View style={s.totals} wrap={false}><View style={s.totalRow}><Text>Products subtotal</Text><Text>{money(doc.subtotalMinor)}</Text></View><View style={s.totalRow}><Text>Shipping{doc.shippingConfirmed ? "" : " (unconfirmed)"}</Text><Text>{money(doc.shippingMinor)}</Text></View><View style={[s.totalRow, s.grand]}><Text>Total ({doc.currency})</Text><Text>{money(doc.totalMinor)}</Text></View></View>
      <View style={s.section}><Text style={s.heading}>Payment terms</Text><Text>Required before shipment: {doc.preShipmentPercent}%</Text><Copy>{doc.paymentTerms || "Payment terms have not been agreed."}</Copy></View>
      <View style={s.section}><Text style={s.heading}>Ship to</Text><Copy>{[doc.shippingRecipient, doc.shippingPhone, doc.shippingAddress].filter(Boolean).join("\n") || "Shipping address to be confirmed."}</Copy></View>
      {doc.notes ? <View style={s.section}><Text style={s.heading}>Notes</Text><Copy>{doc.notes}</Copy></View> : null}
      <Text style={s.muted}>This quotation is an offer, not a tax invoice or payment receipt.</Text>
      <View style={s.footer} fixed><Text>{reference}</Text></View>
    </Page>
  </Document>);
}
