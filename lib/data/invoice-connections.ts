import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { blankInvoiceDocument, type InvoiceDocument } from "../invoices";
import { relatedInvoices } from "./invoice-related";
import {
  invoiceProduct,
  productUnitPrice,
  withBillingCustomer,
  type BillingCustomer,
  type BillingProfile,
  type InvoiceProductRow,
  type SellerSettings,
} from "../invoice-links";

export class InvoiceConnectionError extends Error {
  code = "P0001";
}
const customerSelect = "id,name,city,country,contacts(id,name,email)";
export const invoiceProductSelect =
  "sku,name,image_url,currency,price,moq,color,tags,stock_status,active";
function searchText(value: string) {
  return value.replace(/[^\p{L}\p{N}\s@._-]/gu, "").slice(0, 100);
}

export async function invoiceCustomers(search = "", page = 0) {
  const db = createSupabaseAdmin();
  const term = searchText(search);
  const matches = term
    ? await db
        .from("contacts")
        .select("company_id")
        .ilike("email", `%${term}%`)
        .limit(100)
    : null;
  if (matches?.error) throw matches.error;
  const ids = [
    ...new Set((matches?.data ?? []).map((item) => item.company_id)),
  ];
  let query = db
    .from("companies")
    .select(customerSelect, { count: "exact" })
    .order("name")
    .order("id");
  if (term)
    query = query.or(
      `name.ilike.%${term}%${ids.length ? `,id.in.(${ids.join(",")})` : ""}`,
    );
  const { data, error, count } = await query.range(page * 25, page * 25 + 24);
  if (error) throw error;
  return { customers: data as unknown as BillingCustomer[], count: count ?? 0 };
}
export async function invoiceProducts(
  search = "",
  page = 0,
  currency = "",
  skus?: string[],
) {
  let query = createSupabaseAdmin()
    .from("products")
    .select(invoiceProductSelect, { count: "exact" })
    .eq("active", true)
    .not("sku", "like", "SAMPLE-%")
    .order("name")
    .order("sku");
  const term = searchText(search);
  if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
  if (currency) query = query.eq("currency", currency);
  if (skus) query = query.in("sku", skus);
  const { data, error, count } = await query.range(
    skus ? 0 : page * 25,
    skus ? 99 : page * 25 + 24,
  );
  if (error) throw error;
  return {
    products: (data as InvoiceProductRow[]).map(invoiceProduct),
    count: count ?? 0,
  };
}
export async function customerBilling(companyId: string) {
  const db = createSupabaseAdmin();
  const [customer, profile, catalogs] = await Promise.all([
    db
      .from("companies")
      .select(customerSelect)
      .eq("id", companyId)
      .maybeSingle(),
    db
      .from("customer_billing_profiles")
      .select("profile")
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("catalogs")
      .select("id,version,currency,product_skus,price_date")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);
  if (customer.error || profile.error || catalogs.error)
    throw customer.error || profile.error || catalogs.error;
  if (!customer.data)
    throw new InvoiceConnectionError("This customer no longer exists.");
  return {
    customer: customer.data as unknown as BillingCustomer,
    profile: (profile.data?.profile ?? null) as BillingProfile | null,
    catalogs: catalogs.data ?? [],
  };
}
export async function invoiceBootstrap(input: {
  companyId?: string;
  email?: string;
  threadId?: string;
}) {
  const db = createSupabaseAdmin();
  let companyId = input.companyId;
  let contactId: string | undefined;
  if (input.email) {
    const contact = await db
      .from("contacts")
      .select("id,company_id")
      .eq("email", input.email.trim().toLowerCase())
      .maybeSingle();
    if (contact.error) throw contact.error;
    if (contact.data && (!companyId || companyId === contact.data.company_id)) {
      companyId = contact.data.company_id;
      contactId = contact.data.id;
    }
  }
  const [settings, billing, invoices] = await Promise.all([
    db
      .from("invoice_settings")
      .select("settings")
      .eq("singleton", true)
      .maybeSingle(),
    companyId ? customerBilling(companyId) : Promise.resolve(null),
    relatedInvoices({ companyId, email: input.email, threadId: input.threadId }),
  ]);
  if (settings.error) throw settings.error;
  let document = {
    ...blankInvoiceDocument(new Date().toISOString().slice(0, 10)),
    ...(settings.data?.settings as SellerSettings | undefined),
    ...(input.threadId ? { sourceThreadId: input.threadId } : {}),
    ...(input.email ? { customerEmail: input.email } : {}),
  };
  if (billing) {
    document = withBillingCustomer(
      document,
      billing.customer,
      billing.profile,
      contactId,
    );
    // An inbox action bills the selected correspondent, even if another contact is primary.
    if (contactId && input.email) document.customerEmail = input.email;
  }
  return { document, billing, invoices };
}
export async function validateInvoiceConnections(document: InvoiceDocument) {
  const db = createSupabaseAdmin();
  const skus = [
    ...new Set(
      document.items.flatMap((item) =>
        item.productSku ? [item.productSku] : [],
      ),
    ),
  ];
  const [company, contact, products] = await Promise.all([
    document.companyId
      ? db
          .from("companies")
          .select("id")
          .eq("id", document.companyId)
          .maybeSingle()
      : Promise.resolve(null),
    document.contactId
      ? db
          .from("contacts")
          .select("company_id")
          .eq("id", document.contactId)
          .maybeSingle()
      : Promise.resolve(null),
    skus.length
      ? db.from("products").select(invoiceProductSelect).in("sku", skus)
      : Promise.resolve(null),
  ]);
  if (company?.error || contact?.error || products?.error)
    throw company?.error || contact?.error || products?.error;
  if (document.companyId && !company?.data)
    throw new InvoiceConnectionError("Select an existing CRM customer.");
  if (document.contactId && contact?.data?.company_id !== document.companyId)
    throw new InvoiceConnectionError(
      "The selected contact does not belong to this customer.",
    );
  const bySku = new Map(
    ((products?.data as InvoiceProductRow[]) ?? []).map((row) => [
      row.sku,
      row,
    ]),
  );
  for (const item of document.items) {
    if (!item.productSku) continue;
    const row = bySku.get(item.productSku);
    if (!row?.active)
      throw new InvoiceConnectionError(
        `Product ${item.productSku} is unavailable. Remove it or use an unlinked custom line.`,
      );
    const product = invoiceProduct(row);
    const variant = product.variants.find(
      (value) => value.id === item.variantId,
    );
    if (item.variantId && !variant)
      throw new InvoiceConnectionError(
        `Choose a current variant for ${product.name}.`,
      );
    if (item.variantSku && item.variantSku !== variant?.sku)
      throw new InvoiceConnectionError(
        `The SKU for ${product.name} has changed. Select its variant again.`,
      );
    if (product.currency !== document.currency)
      throw new InvoiceConnectionError(
        `Product ${product.name} is priced in ${product.currency}. Use that invoice currency or an unlinked custom line with an agreed price.`,
      );
    if (item.pricingMode === "catalog") {
      if (item.quantity < product.moq)
        throw new InvoiceConnectionError(
          `${product.name} has a minimum quantity of ${product.moq}. Use a manual agreed price for an exception.`,
        );
      const current = productUnitPrice(product, item.quantity, item.variantId);
      if (current === null || current !== item.unitPriceMinor)
        throw new InvoiceConnectionError(
          `Catalog pricing changed for ${product.name}. Refresh its price before saving.`,
        );
    }
  }
}
