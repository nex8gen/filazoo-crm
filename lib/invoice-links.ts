import { z } from "zod";
import { invoiceCurrencies, type InvoiceDocument } from "./invoices.ts";
import { variantsFromTags } from "./product-utils.ts";

export const DEFAULT_INVOICE_PRODUCT_IMAGE = "/catalog-default-product.jpg";

export type BillingCustomer = {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  contacts: { id: string; name: string | null; email: string }[];
};
export const billingProfileSchema = z.object({
  address: z.string().trim().max(2000),
  taxId: z.string().trim().max(100),
  email: z.union([z.email(), z.literal("")]),
  currency: z.enum(invoiceCurrencies),
  termsDays: z.number().int().min(0).max(365),
});
export type BillingProfile = z.infer<typeof billingProfileSchema>;
export const sellerSettingsSchema = z.object({
  sellerName: z.string().trim().min(1).max(200),
  sellerAddress: z.string().trim().max(2000),
  sellerTaxId: z.string().trim().max(100),
  paymentInstructions: z.string().trim().max(2000),
  notes: z.string().trim().max(4000),
});
export type SellerSettings = z.infer<typeof sellerSettingsSchema>;
export type InvoiceProduct = {
  sku: string;
  name: string;
  imageUrl: string | null;
  currency: string;
  priceMinor: number | null;
  moq: number;
  stockStatus: string;
  tiers: { minimumQuantity: number; priceMinor: number }[];
  variants: {
    id: string;
    name: string;
    sku: string;
    priceMinor: number | null;
    stockStatus: string;
    imageUrl: string | null;
  }[];
};
export type InvoiceProductRow = {
  sku: string;
  name: string;
  currency: string;
  price: number | string | null;
  moq: number | null;
  color: string | null;
  tags: string[];
  stock_status: string | null;
  image_url: string | null;
  active: boolean;
};

/** Accept a single quoted amount only. Ranges and missing quotes require a manual price. */
export function quotedMinor(value: string) {
  const normalized = value
    .trim()
    .replace(/^(?:[A-Z]{2,3}\s*)?[$€£¥￥]?\s*/, "");
  if (!/^\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(normalized)) return null;
  const minor = Math.round(Number(normalized.replaceAll(",", "")) * 100);
  return Number.isSafeInteger(minor) && minor <= 100_000_000 ? minor : null;
}
export function invoiceProduct(row: InvoiceProductRow): InvoiceProduct {
  const priceMinor = row.price === null ? null : quotedMinor(String(row.price));
  const stockStatus = row.stock_status || "Confirm availability";
  const variants = variantsFromTags(
    row.tags,
    (row.color ?? "")
      .split(",")
      .map((color) => color.trim())
      .filter(Boolean),
    row.sku,
    row.price === null ? "" : String(row.price),
    stockStatus,
  );
  const tiers = row.tags
    .flatMap((tag) => {
      const match = /^price-tier:(\d+):(\d+(?:\.\d{1,2})?)$/.exec(tag);
      const minor = match ? quotedMinor(match[2]) : null;
      return match && minor !== null && Number(match[1]) > 0
        ? [{ minimumQuantity: Number(match[1]), priceMinor: minor }]
        : [];
    })
    .sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  return {
    sku: row.sku,
    name: row.name,
    imageUrl: row.image_url,
    currency: row.currency.trim(),
    priceMinor,
    moq: Math.max(1, row.moq ?? 1),
    stockStatus,
    tiers,
    variants: variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      priceMinor: quotedMinor(variant.price),
      stockStatus: variant.stockStatus,
      imageUrl: variant.imageUrl,
    })),
  };
}
export function productUnitPrice(
  product: InvoiceProduct,
  quantity: number,
  variantId?: string,
) {
  const variant = variantId
    ? product.variants.find((item) => item.id === variantId)
    : undefined;
  if (variantId && !variant) return null;
  if (variant && variant.priceMinor !== product.priceMinor)
    return variant.priceMinor;
  return (
    [...product.tiers]
      .reverse()
      .find((tier) => quantity >= tier.minimumQuantity)?.priceMinor ??
    variant?.priceMinor ??
    product.priceMinor
  );
}
export function productInvoiceLine(
  product: InvoiceProduct,
  quantity: number,
  variantId?: string,
): InvoiceDocument["items"][number] {
  const variant = product.variants.find((item) => item.id === variantId);
  const price = productUnitPrice(product, quantity, variantId);
  return {
    productSku: product.sku,
    ...(variant ? { variantId: variant.id, variantSku: variant.sku } : {}),
    imageUrl:
      variant?.imageUrl || product.imageUrl || DEFAULT_INVOICE_PRODUCT_IMAGE,
    description: `${product.name}${variant ? ` — ${variant.name}` : ""}`,
    quantity,
    unitPriceMinor: price ?? 0,
    taxBps: 0,
    pricingMode: price === null ? "manual" : "catalog",
  };
}

export function withInvoiceProductImages(
  doc: InvoiceDocument,
  products: InvoiceProduct[],
): InvoiceDocument {
  const bySku = new Map(products.map((product) => [product.sku, product]));
  let changed = false;
  const items = doc.items.map((item) => {
    if (item.imageUrl || !item.productSku) return item;
    const product = bySku.get(item.productSku);
    const variant = product?.variants.find((value) => value.id === item.variantId);
    const imageUrl =
      variant?.imageUrl ||
      product?.imageUrl ||
      (product ? DEFAULT_INVOICE_PRODUCT_IMAGE : undefined);
    if (!imageUrl) return item;
    changed = true;
    return { ...item, imageUrl };
  });
  return changed ? { ...doc, items } : doc;
}
export function withBillingCustomer(
  doc: InvoiceDocument,
  customer: BillingCustomer,
  profile?: BillingProfile | null,
  contactId?: string,
): InvoiceDocument {
  const contact =
    customer.contacts.find((item) => item.id === contactId) ??
    customer.contacts[0];
  const due = z.iso.date().safeParse(doc.issueDate).success
    ? new Date(`${doc.issueDate}T00:00:00Z`)
    : null;
  if (due) due.setUTCDate(due.getUTCDate() + (profile?.termsDays ?? 0));
  return {
    ...doc,
    companyId: customer.id,
    contactId: contact?.id,
    customerName: customer.name,
    customerEmail: profile?.email || contact?.email || "",
    customerAddress:
      profile?.address ??
      [customer.city, customer.country].filter(Boolean).join(", "),
    customerTaxId: profile?.taxId ?? "",
    ...(doc.items.every((item) => !item.description) && profile
      ? { currency: profile.currency }
      : {}),
    dueDate: due ? due.toISOString().slice(0, 10) : doc.dueDate,
  };
}
