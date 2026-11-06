import { commerceDefaults } from "./company-commerce.ts";
import { applyOrderProfile, orderProductLine, refreshOrderProductLine } from "./purchase-order-links.ts";
import { productUnitPrice, type InvoiceProduct } from "./invoice-links.ts";
import type { OrderProfile, PurchaseOrder, PurchaseOrderDocument } from "./purchase-orders.ts";

export const orderShippingSku = "SHIPPING";
export function blankPurchaseOrder(today: string, profile?: OrderProfile | null): PurchaseOrderDocument {
  const defaults = commerceDefaults(profile?.commerce);
  const document: PurchaseOrderDocument = {
    reference: "", orderDate: today, deliveryDate: "", currency: defaults.currency, status: "draft",
    paymentPolicy: "full_before_shipment", preShipmentPercent: 100, paymentTerms: "",
    shippingAddress: "", shippingRecipient: "", shippingPhone: "", notes: "", items: [],
  };
  return profile ? applyOrderProfile(document, profile) : document;
}

export function purchaseOrderEditorDocument(today: string, profile?: OrderProfile | null, order?: PurchaseOrder): PurchaseOrderDocument {
  return order ? { ...order.document, customer: order.document.customer ?? profile?.customer } : blankPurchaseOrder(today, profile);
}

export function purchaseOrderCommercialDetailsLocked(order?: PurchaseOrder) {
  return Boolean(order?.invoices?.some(invoice => invoice.status === "issued" || (invoice.status === "draft" && !invoice.order_managed)));
}

export function productSelectionKey(productSku: string, variantId?: string) {
  return JSON.stringify([productSku, variantId ?? ""]);
}

export function orderProductChoices(product: InvoiceProduct) {
  return (product.variants.length ? product.variants : [undefined]).map(variant => ({
    key: productSelectionKey(product.sku, variant?.id),
    variant,
    price: productUnitPrice(product, product.moq, variant?.id),
    item: orderProductLine(product, product.moq, variant?.id),
  }));
}

export function draftProductAvailable(item: PurchaseOrderDocument["items"][number], product?: InvoiceProduct, currency = product?.currency) {
  return Boolean(product && item.productSku === product.sku && product.currency === currency
    && (!item.variantId || product.variants.some(variant => variant.id === item.variantId)));
}

export function changeDraftQuantity(item: PurchaseOrderDocument["items"][number], quantity: number, product?: InvoiceProduct) {
  const available = draftProductAvailable(item, product);
  const price = item.pricingMode === "catalog" && product && available ? productUnitPrice(product, quantity, item.variantId) : null;
  const refreshed = product && available ? refreshOrderProductLine({ ...item, quantity }, product, false) : { ...item, quantity };
  return { ...refreshed, pricingMode: item.pricingMode, ...(price !== null ? { unitPriceMinor: price } : {}) };
}

export function draftPaymentTotals(items: PurchaseOrderDocument["items"]) {
  let subtotal = 0, shipping = 0, quantity = 0;
  for (const item of items) {
    const amount = item.quantity * item.unitPriceMinor;
    if (item.sku === orderShippingSku && !item.productSku) shipping += amount;
    else { subtotal += amount; quantity += item.quantity; }
  }
  return { subtotal, shipping, quantity, total: subtotal + shipping };
}
