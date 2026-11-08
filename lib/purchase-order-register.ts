import { orderBillingSummary, poStatusLabels, purchaseOrderLabel, type PurchaseOrder } from "./purchase-orders.ts";
import { draftPaymentTotals } from "./purchase-order-draft.ts";
import { orderIsOverdue } from "./purchase-order-overview.ts";

export type RegisterBadge = { label: string; tone: "neutral" | "yellow" | "green" | "red" | "blue"; filled?: boolean };
export type PurchaseOrderRegisterRow = {
  id: string;
  label: string;
  reference: string;
  createdAt: string;
  orderDate: string;
  companyId: string;
  customer: string;
  deliveryDate: string;
  overdue: boolean;
  currency: string;
  total: number;
  itemCount: number;
  payment: RegisterBadge;
  orderStatus: RegisterBadge;
  invoiceBalance: number;
  delivery: RegisterBadge | null;
  closed: boolean;
};

type RegisterOrder = PurchaseOrder & {
  companyName: string;
  shipments?: { invoice_id: string; status: string; tracking_number?: string | null }[];
};

export function purchaseOrderRegisterRow(order: RegisterOrder, today?: string): PurchaseOrderRegisterRow {
  const billing = orderBillingSummary(order);
  const status = order.document.status;
  const issuedInvoices = order.invoices?.filter(invoice => invoice.status === "issued") ?? [];
  const paid = billing.fullyInvoiced && billing.paid >= billing.total;
  const payment: RegisterBadge = paid
    ? { label: "Paid", tone: "green", filled: true }
    : billing.paid > 0
      ? { label: "Partially paid", tone: "yellow", filled: true }
      : issuedInvoices.length ? { label: "Unpaid", tone: "yellow" } : { label: "Not invoiced", tone: "neutral" };
  const orderStatus: RegisterBadge = {
    label: poStatusLabels[status],
    tone: status === "in_production" ? "yellow" : status === "shipped" || status === "confirmed" ? "blue" : status === "completed" ? "green" : "neutral",
    filled: status === "completed" || status === "cancelled",
  };
  const shipments = order.shipments ?? [];
  const deliveredInvoices = new Set(shipments.filter(shipment => shipment.status === "delivered").map(shipment => shipment.invoice_id));
  let delivery: RegisterBadge | null = null;
  if (shipments.some(shipment => shipment.status === "exception")) delivery = { label: "Exception", tone: "red" };
  else if (billing.fullyInvoiced && issuedInvoices.length && issuedInvoices.every(invoice => deliveredInvoices.has(invoice.id))) delivery = { label: "Delivered", tone: "green", filled: true };
  else if (shipments.some(shipment => shipment.status === "out_for_delivery")) delivery = { label: "Out for delivery", tone: "green" };
  else if (shipments.some(shipment => shipment.status === "in_transit")) delivery = { label: "In transit", tone: "neutral" };
  else if (shipments.some(shipment => shipment.status === "delivered")) delivery = { label: "Partially delivered", tone: "neutral", filled: true };
  else if (shipments.some(shipment => shipment.tracking_number)) delivery = { label: "Tracking added", tone: "neutral", filled: true };
  else if (shipments.length) delivery = { label: "Preparing", tone: "neutral" };
  const label = purchaseOrderLabel(order);
  return {
    id: order.id, label,
    reference: [label, String(order.number ?? "")].includes(order.document.reference) ? "" : order.document.reference,
    createdAt: order.created_at, orderDate: order.document.orderDate, companyId: order.company_id, customer: order.companyName,
    deliveryDate: order.document.deliveryDate, overdue: today ? orderIsOverdue(order.document, today) : false,
    currency: order.document.currency, total: order.total_minor,
    itemCount: draftPaymentTotals(order.document.items).quantity,
    payment, orderStatus, invoiceBalance: Math.max(0, billing.outstanding), delivery,
    closed: ["completed", "cancelled"].includes(status),
  };
}

const dayMs = 86_400_000;
export function registerDate(value: string, today: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const day = date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const daysAgo = Math.round((Date.parse(`${today}T00:00:00+08:00`) - Date.parse(`${day}T00:00:00+08:00`)) / dayMs);
  const prefix = daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", ...(daysAgo > 1 && daysAgo < 7 ? { weekday: "long" } : { month: "short", day: "numeric", ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) }),
  }).format(date);
  return `${prefix} at ${new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "numeric", minute: "2-digit" }).format(date).toLowerCase()}`;
}

export function registerOrderDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00+08:00`));
}
