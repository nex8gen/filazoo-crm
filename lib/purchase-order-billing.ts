import { blankInvoiceDocument, invoiceTotals, type InvoiceDocument } from "./invoices.ts";
import type { OrderBilling, PurchaseOrderDocument } from "./purchase-orders.ts";

export function orderBillingFromInvoice(doc: InvoiceDocument, taxBps = doc.items[0]?.taxBps ?? 0): OrderBilling {
  return { issueDate: doc.issueDate, dueDate: doc.dueDate, discountMinor: doc.discountMinor, taxBps,
    paymentMethods: doc.paymentMethods };
}
export function orderInvoiceDraft(order: PurchaseOrderDocument): InvoiceDocument {
  const seed = blankInvoiceDocument(order.orderDate);
  const billing = order.billing ? orderBillingFromInvoice({ ...seed, ...order.billing }, order.billing.taxBps) : {};
  return { ...seed, ...billing, currency: order.currency, reference: order.reference,
    customerName: order.customer?.companyName || "", customerEmail: order.customer?.billingEmail || order.customer?.contactEmail || "",
    customerAddress: order.customer?.billingAddress || "", customerTaxId: order.customer?.taxId || "",
    items: order.items.map(item => ({ description: item.description, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor,
      taxBps: item.sku === "SHIPPING" && !item.productSku ? 0 : order.billing?.taxBps ?? 0 })),
  };
}
export function purchaseOrderAmounts(order: PurchaseOrderDocument) { return invoiceTotals(orderInvoiceDraft(order)); }
