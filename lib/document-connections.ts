import type { DocumentCategory, LibraryDocument } from "./documents.ts";

export type DocumentConnections = { company_id: string | null; purchase_order_id: string | null; invoice_id: string | null; product_skus: string[] };
export const emptyDocumentConnections: DocumentConnections = { company_id: null, purchase_order_id: null, invoice_id: null, product_skus: [] };
export type DocumentConnectionContext = {
  companies: { id: string; name: string }[];
  products: { sku: string; name: string; currency: string }[];
  orders: { id: string; number: number; company_id: string; reference: string; company: string; status: string }[];
  invoices: { id: string; number: number; company_id: string | null; purchase_order_id: string | null; status: string }[];
};
export function documentConnectionError(category: DocumentCategory, value: DocumentConnections) {
  if (category === "quotation" && !value.company_id) return "Choose the customer for this quotation.";
  if (["quotation", "catalog", "datasheet"].includes(category) && !value.product_skus.length) return "Select at least one related product.";
  if (["proforma", "invoice", "payment"].includes(category) && !value.purchase_order_id) return "Choose the related purchase order.";
  if (category === "purchase_order" && !value.company_id) return "Choose the customer for this purchase order.";
  return "";
}
export function documentSourceHref(document: LibraryDocument) {
  if (!document.source_type || !document.source_id) return null;
  if (document.source_type === "quotation") return `/company-quotations/${document.source_id}`;
  if (document.purchase_order_id) return `/purchase-orders/${document.purchase_order_id}`;
  if (document.invoice_id) return `/invoices/${document.invoice_id}`;
  if (document.source_type === "purchase_order") return `/purchase-orders/${document.source_id}`;
  return null;
}
export function documentSizeLabel(document: LibraryDocument) {
  return document.source_type ? document.mime_type === "application/pdf" ? "CRM PDF · live record" : "CRM record" : "";
}
