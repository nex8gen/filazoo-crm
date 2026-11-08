import type { InvoiceProduct } from "../invoice-links.ts";
import { purchaseOrderCreateSchema, type PurchaseOrderDocument } from "../purchase-orders.ts";
import { invoiceDocumentSchema, type InvoiceDocument } from "../invoices.ts";

/** The same supported billing shape as the order editor and automatic invoice trigger. */
export function agentOrderFromInvoice(document: InvoiceDocument) {
  const taxes = [...new Set(document.items.map(item => item.taxBps))];
  if (taxes.length !== 1) throw new Error("Order billing uses one tax rate. Choose a single tax rate for this order.");
  const shipping = document.shippingMinor ? [{ description: "Shipping", sku: "SHIPPING", quantity: 1, unitPriceMinor: document.shippingMinor }] : [];
  const order = purchaseOrderCreateSchema.parse({
    reference: document.reference, orderDate: document.issueDate, deliveryDate: "", currency: document.currency, status: "draft",
    customer: { companyName: document.customerName, contactId: document.contactId, contactName: "", contactRole: "", contactEmail: document.customerEmail, billingEmail: document.customerEmail, billingAddress: document.customerAddress, taxId: document.customerTaxId, phone: "" },
    shippingAddress: document.shippingAddress ?? "", shippingRecipient: document.shippingRecipient ?? "", shippingPhone: document.shippingPhone ?? "", notes: document.notes,
    billing: { issueDate: document.issueDate, dueDate: document.dueDate, discountMinor: document.discountMinor, taxBps: taxes[0], paymentMethods: document.paymentMethods },
    items: [...document.items.map(item => ({ description: item.description, sku: item.variantSku || item.productSku || "", productSku: item.productSku, variantId: item.variantId, variantSku: item.variantSku, imageUrl: item.imageUrl, pricingMode: item.pricingMode, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor })), ...shipping],
  });
  const preview = invoiceDocumentSchema.parse({ ...document, bankAccountId: undefined, bankAccount: undefined, paymentInstructions: "", shippingMinor: 0,
    items: [...document.items, ...shipping.map(item => ({ description: item.description, quantity: 1, unitPriceMinor: item.unitPriceMinor, taxBps: 0 }))],
  });
  return { order, document: preview };
}

/** Compare only approved commercial fields; generated IDs/numbers and line links differ. */
export function orderInvoiceMatchesReview(actual: InvoiceDocument, approved: InvoiceDocument) {
  const current = invoiceDocumentSchema.safeParse(actual);
  const review = invoiceDocumentSchema.safeParse(approved);
  if (!current.success || !review.success) return false;
  const fields = (document: InvoiceDocument) => ({
    sellerName: document.sellerName, sellerAddress: document.sellerAddress, sellerTaxId: document.sellerTaxId,
    reference: approved.reference ? document.reference : "",
    customerName: document.customerName, customerEmail: document.customerEmail, customerAddress: document.customerAddress, customerTaxId: document.customerTaxId,
    currency: document.currency, issueDate: document.issueDate, dueDate: document.dueDate, discountMinor: document.discountMinor, shippingMinor: document.shippingMinor,
    shippingAddress: document.shippingAddress || "", shippingRecipient: document.shippingRecipient || "", shippingPhone: document.shippingPhone || "",
    paymentMethods: document.paymentMethods ?? [],
    items: document.items.map(item => ({ description: item.description, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, taxBps: item.taxBps,
      productSku: item.productSku, variantId: item.variantId, variantSku: item.variantSku, imageUrl: item.imageUrl })),
  });
  // JSONB may reorder object keys. Parsing both snapshots gives nested payment
  // methods the same schema order before comparing their approved values.
  return JSON.stringify(fields(current.data)) === JSON.stringify(fields(review.data));
}
import { orderProductError, orderProductLine } from "../purchase-order-links.ts";

/** Build new/edited catalog lines from authoritative products before approval. */
export function groundOrderProducts(document: PurchaseOrderDocument, products: InvoiceProduct[], previous?: PurchaseOrderDocument): PurchaseOrderDocument {
  const catalog = new Map(products.map(product => [product.sku, product]));
  return { ...document, items: document.items.map((item, index) => {
    if (!item.productSku || (previous?.currency === document.currency && JSON.stringify(previous.items[index]) === JSON.stringify(item))) return item;
    const product = catalog.get(item.productSku);
    if (!product) throw new Error(`Product ${item.productSku} is unavailable. Look up the current catalog product.`);
    // IDs and SKU selections must agree. Missing display fields can be filled;
    // conflicting selections must be resolved rather than silently replaced.
    const byId = item.variantId ? product.variants.find(variant => variant.id === item.variantId) : undefined;
    if (item.variantId && !byId) throw new Error(`Look up the current variant for ${product.name}.`);
    const selectedSkus = [item.variantSku, item.sku !== product.sku ? item.sku : undefined].filter((sku): sku is string => Boolean(sku));
    let variant = byId;
    for (const sku of selectedSkus) {
      const matches = product.variants.filter(value => value.sku === sku);
      if (matches.length !== 1 || (variant && variant.id !== matches[0].id)) throw new Error(`The variant selections for ${product.name} disagree. Look up the requested variant and use its matching ID and SKU.`);
      variant = matches[0];
    }
    if (!item.pricingMode) throw new Error(`Choose catalog pricing or the customer's agreed manual price for ${product.name}.`);
    const line = orderProductLine(product, item.quantity, variant?.id);
    if (item.pricingMode === "catalog" && line.pricingMode !== "catalog") throw new Error(`No catalog price is saved for ${product.name}. Ask for the agreed price.`);
    const grounded = item.pricingMode === "manual" ? { ...line, pricingMode: "manual" as const, unitPriceMinor: item.unitPriceMinor } : line;
    const error = orderProductError(grounded, product, document.currency);
    if (error) throw new Error(error);
    return grounded;
  }) };
}
