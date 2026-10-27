import type { PurchaseOrderDocument } from "./purchase-orders.ts";

export type AnalysisOrder = {
  id: string;
  reference: string;
  orderDate: string;
  deliveryDate: string;
  currency: string;
  status: PurchaseOrderDocument["status"];
  items: Pick<PurchaseOrderDocument["items"][number], "description" | "sku" | "productSku" | "variantId" | "quantity" | "unitPriceMinor">[];
};
export type CompanyAnalysisData = {
  orders: AnalysisOrder[];
  products: { sku: string; name: string }[];
  tasks: { id: string; notes: string | null; due_at: string | null }[];
  asOf: string;
};
export type AnalysisRange = { from: string; to: string };
export type ProductReminder = {
  key: string;
  name: string;
  sku: string;
  lastDate: string;
  lastQuantity: number;
  orderCount: number;
  daysSince: number;
  averageGap: number | null;
  kind: "receipt" | "fulfillment" | "restock" | "demand" | "history" | "monitor";
};
const DAY = 86_400_000;
const dayTime = (value: string) => Date.parse(`${value}T00:00:00Z`);
export function analysisToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function analysisDaysAgo(today: string, days: number) {
  return new Date(dayTime(today) - days * DAY).toISOString().slice(0, 10);
}
export function isEffectiveOrder(order: AnalysisOrder, today: string) {
  return order.status !== "draft" && order.status !== "cancelled" && order.orderDate <= today;
}
export function analysisProductKey(item: AnalysisOrder["items"][number]) {
  return JSON.stringify([item.productSku || item.sku || item.description, item.variantId || item.sku || item.description]);
}
export function analysisTaskMarker(key: string) { return `Company purchase analysis: ${key}`; }

export function companyPurchaseAnalysis(data: CompanyAnalysisData, currency: string, range: AnalysisRange) {
  const today = analysisToday(new Date(data.asOf));
  const history = data.orders.filter(order => order.currency === currency && isEffectiveOrder(order, today))
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.id.localeCompare(a.id));
  const orders = history.filter(order => (!range.from || order.orderDate >= range.from) && order.orderDate <= range.to);
  const productNames = new Map(data.products.map(product => [product.sku, product.name]));
  const productMap = new Map<string, { key: string; name: string; amountMinor: number; quantity: number }>();
  const monthMap = new Map<string, number>();
  let amountMinor = 0, quantity = 0;
  for (const order of orders) {
    for (const item of order.items) {
      const amount = item.quantity * item.unitPriceMinor;
      const key = item.productSku || item.sku || item.description;
      const product = productMap.get(key) ?? { key, name: productNames.get(key) || item.description, amountMinor: 0, quantity: 0 };
      product.amountMinor += amount;
      product.quantity += item.quantity;
      productMap.set(key, product);
      amountMinor += amount;
      quantity += item.quantity;
      const month = order.orderDate.slice(0, 7);
      monthMap.set(month, (monthMap.get(month) ?? 0) + amount);
    }
  }
  // Include zero-purchase months within the selected date range.
  const months: { month: string; amountMinor: number }[] = [];
  const firstMonth = (range.from || orders.at(-1)?.orderDate || range.to).slice(0, 7);
  const lastMonth = range.to.slice(0, 7);
  if (firstMonth <= lastMonth) {
    const cursor = new Date(`${firstMonth}-01T00:00:00Z`);
    while (cursor.toISOString().slice(0, 7) <= lastMonth) {
      const month = cursor.toISOString().slice(0, 7);
      months.push({ month, amountMinor: monthMap.get(month) ?? 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const products = [...productMap.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.name.localeCompare(b.name))
    .map(product => ({ ...product, share: amountMinor ? product.amountMinor / amountMinor : 0 }));
  const purchases = new Map<string, { name: string; sku: string; orders: { date: string; quantity: number; status: AnalysisOrder["status"] }[] }>();
  for (const order of history) {
    const lines = new Map<string, { item: AnalysisOrder["items"][number]; quantity: number }>();
    for (const item of order.items) {
      const key = analysisProductKey(item);
      const line = lines.get(key) ?? { item, quantity: 0 };
      line.quantity += item.quantity;
      lines.set(key, line);
    }
    for (const [key, { item, quantity: count }] of lines) {
      const purchase = purchases.get(key) ?? { name: item.description, sku: item.sku || item.productSku || "", orders: [] };
      purchase.orders.push({ date: order.orderDate, quantity: count, status: order.status });
      purchases.set(key, purchase);
    }
  }
  const reminders: ProductReminder[] = [...purchases].map(([key, purchase]) => {
    const last = purchase.orders[0];
    // Distinct purchase days avoid counting split orders as a replenishment cycle.
    const dates = [...new Set(purchase.orders.map(order => order.date))].slice(0, 5);
    const gaps = dates.slice(1).map((date, i) => (dayTime(dates[i]) - dayTime(date)) / DAY);
    const average = gaps.length >= 2 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const variation = average ? Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - average) ** 2, 0) / gaps.length) / average : null;
    const daysSince = Math.max(0, Math.round((dayTime(today) - dayTime(last.date)) / DAY));
    const kind = last.status === "shipped" ? "receipt" : last.status === "confirmed" || last.status === "in_production" ? "fulfillment" : average === null ? "history" : variation! > 0.35 ? "demand" : daysSince >= average ? "restock" : "monitor";
    return { key, name: purchase.name, sku: purchase.sku, lastDate: last.date, lastQuantity: last.quantity, orderCount: purchase.orders.length, daysSince, averageGap: average === null ? null : Math.round(average), kind };
  });
  const priority = { receipt: 0, fulfillment: 1, restock: 2, demand: 3, history: 4, monitor: 5 };
  reminders.sort((a, b) => priority[a.kind] - priority[b.kind] || b.daysSince - a.daysSince || a.name.localeCompare(b.name));
  const peak = months.reduce<{ month: string; amountMinor: number } | null>((best, month) => month.amountMinor > (best?.amountMinor ?? 0) ? month : best, null);
  return { orders, amountMinor, quantity, orderCount: orders.length, averageMinor: orders.length ? Math.round(amountMinor / orders.length) : 0, months, products, peak, latest: history[0] ?? null, reminders };
}

function csvCell(value: string | number) {
  const text = String(value);
  // Neutralize spreadsheet formulas in customer-entered references and descriptions.
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}
export function companyAnalysisCsv(orders: AnalysisOrder[]) {
  const rows: (string | number)[][] = [["Order reference", "Order date", "Status", "Currency", "Product", "SKU", "Quantity", "Unit price", "Line amount"]];
  for (const order of orders) for (const item of order.items) rows.push([order.reference, order.orderDate, order.status, order.currency, item.description, item.sku, item.quantity, (item.unitPriceMinor / 100).toFixed(2), (item.quantity * item.unitPriceMinor / 100).toFixed(2)]);
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
