export function orderInvoiceHref(invoice: { id: string; document?: { purchaseOrderId?: string }; purchase_order_id?: string | null }) {
  const orderId = invoice.document?.purchaseOrderId || invoice.purchase_order_id;
  return orderId ? `/purchase-orders/${orderId}` : "/purchase-orders";
}
