import {
  productInvoiceLine,
  productUnitPrice,
  type InvoiceProduct,
} from "./invoice-links.ts";
import type { InvoiceDocument } from "./invoices.ts";
import type { OrderProfile, PurchaseOrderDocument } from "./purchase-orders.ts";

export function orderProductLine(
  product: InvoiceProduct,
  quantity = product.moq,
  variantId?: string,
): PurchaseOrderDocument["items"][number] {
  const line = productInvoiceLine(product, quantity, variantId);
  return {
    description: line.description,
    sku: line.variantSku || product.sku,
    productSku: product.sku,
    variantId: line.variantId,
    variantSku: line.variantSku,
    imageUrl: line.imageUrl,
    pricingMode: line.pricingMode,
    quantity,
    unitPriceMinor: line.unitPriceMinor,
  };
}
export function orderProductError(
  item: PurchaseOrderDocument["items"][number],
  product: InvoiceProduct | undefined,
  currency: string,
): string | null {
  if (!item.productSku) return null;
  if (!product)
    return `Product ${item.productSku} is unavailable. Choose an active product or use a custom item.`;
  if (!item.pricingMode)
    return `Choose catalog pricing or an agreed manual price for ${product.name}.`;
  if (product.currency !== currency)
    return `${product.name} is priced in ${product.currency}. Choose a product in the order currency.`;
  const variant = product.variants.find((value) => value.id === item.variantId);
  if (item.variantId && !variant)
    return `Choose a current variant for ${product.name}.`;
  if (
    item.variantSku !== variant?.sku ||
    item.sku !== (variant?.sku || product.sku)
  )
    return `The SKU for ${product.name} does not match the selected product / variant.`;
  const expected = productInvoiceLine(product, item.quantity, item.variantId);
  if (
    item.description !== expected.description ||
    item.imageUrl !== expected.imageUrl
  )
    return `Product details changed for ${product.name}. Select it again from the catalog.`;
  if (item.pricingMode === "catalog") {
    if (item.quantity < product.moq)
      return `${product.name} has a minimum order quantity of ${product.moq}. Use an agreed manual price for an exception.`;
    const price = productUnitPrice(product, item.quantity, item.variantId);
    if (price === null || price !== item.unitPriceMinor)
      return `Catalog pricing changed for ${product.name}. Refresh the catalog price or enter an agreed manual price.`;
  }
  return null;
}

/** Refresh identity and images together; retain negotiated prices unless explicitly repricing. */
export function refreshOrderProductLine(
  item: PurchaseOrderDocument["items"][number],
  product: InvoiceProduct,
  useCatalogPrice = item.pricingMode === "catalog",
): PurchaseOrderDocument["items"][number] {
  const refreshed = orderProductLine(product, item.quantity, item.variantId);
  return useCatalogPrice
    ? refreshed
    : { ...refreshed, unitPriceMinor: item.unitPriceMinor, pricingMode: "manual" };
}

/** A custom item keeps the agreed description, SKU, quantity, and amount. */
export function customOrderLine(item: PurchaseOrderDocument["items"][number]) {
  return {
    description: item.description,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceMinor: item.unitPriceMinor,
  };
}

export function applyOrderProfile(
  document: PurchaseOrderDocument,
  profile: OrderProfile,
  contactId?: string,
): PurchaseOrderDocument {
  const contact = profile.contacts.find((item) => item.id === contactId);
  return {
    ...document,
    customer: contact
      ? {
          ...profile.customer,
          contactId: contact.id,
          contactName: contact.name,
          contactEmail: contact.email,
          contactRole: contact.role,
          billingEmail: profile.commerce.email || contact.email,
        }
      : { ...profile.customer },
    shippingAddress: profile.commerce.shippingAddress,
    shippingRecipient:
      profile.commerce.shippingRecipient ||
      contact?.name ||
      profile.customer.contactName,
    shippingPhone: profile.commerce.shippingPhone || profile.commerce.phone,
  };
}
export function orderInvoiceItem(
  item: PurchaseOrderDocument["items"][number],
  quantity: number,
  lineId: string,
): InvoiceDocument["items"][number] {
  return {
    description: item.description,
    quantity,
    unitPriceMinor: item.unitPriceMinor,
    taxBps: 0,
    purchaseOrderLineId: lineId,
    productSku: item.productSku,
    variantId: item.variantId,
    variantSku: item.variantSku,
    imageUrl: item.imageUrl,
    ...(item.productSku ? { pricingMode: "manual" as const } : {}),
  };
}
export function orderInvoiceProductMatches(
  item: InvoiceDocument["items"][number],
  source: PurchaseOrderDocument["items"][number],
) {
  return (
    item.productSku === source.productSku &&
    item.variantId === source.variantId &&
    item.variantSku === source.variantSku &&
    item.imageUrl === source.imageUrl &&
    item.unitPriceMinor === source.unitPriceMinor &&
    item.description === source.description &&
    (!item.productSku || item.pricingMode === "manual")
  );
}
export function applyOrderCustomerToInvoice(
  document: InvoiceDocument,
  order: PurchaseOrderDocument,
  currentContactIds: string[],
): InvoiceDocument {
  const customer = order.customer;
  if (!customer) return document;
  return {
    ...document,
    customerName: customer.companyName,
    contactId:
      customer.contactId && currentContactIds.includes(customer.contactId)
        ? customer.contactId
        : undefined,
    customerEmail: customer.billingEmail || customer.contactEmail,
    customerAddress: customer.billingAddress,
    customerTaxId: customer.taxId,
  };
}
