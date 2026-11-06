import { orderBillingSummary, orderHasUnreservedItems, orderInvoiceLocksDetails, poStatuses, type PurchaseOrder } from "./purchase-orders.ts";

export function purchaseOrderActions(order: PurchaseOrder) {
  const billing = orderBillingSummary(order);
  const reserved = order.invoices?.some(orderInvoiceLocksDetails);
  const alreadyShipped = ["shipped", "completed"].includes(order.document.status);
  return {
    canInvoice: !["draft", "cancelled"].includes(order.document.status) && orderHasUnreservedItems(order),
    statuses: poStatuses.filter(status => status !== order.document.status
      && !(reserved && ["draft", "cancelled"].includes(status))
      && !(!alreadyShipped && !billing.canShip && ["shipped", "completed"].includes(status))),
  };
}

export function orderDisplayDate(value: string, withTime = false) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } as const : {}),
  }).format(new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value));
}
