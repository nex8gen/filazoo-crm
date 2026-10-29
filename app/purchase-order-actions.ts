"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import {
  purchaseOrderSchema,
  purchaseOrderTotal,
  orderBillingSummary,
  orderLineId,
  type PurchaseOrder,
  type OrderProfile,
} from "@/lib/purchase-orders";
import {
  invoiceBootstrap,
  invoiceProducts,
  invoiceProductSelect,
} from "@/lib/data/invoice-connections";
import { invoiceProduct, type InvoiceProductRow } from "@/lib/invoice-links";
import { commerceDefaults } from "@/lib/company-commerce";
import {
  orderProductError,
  orderInvoiceItem,
  applyOrderCustomerToInvoice,
} from "@/lib/purchase-order-links";
import { createInvoice } from "@/lib/data/invoices";
import type { InvoiceDocument } from "@/lib/invoices";

export async function getPurchaseOrderProfile(
  companyId: string,
): Promise<OrderProfile> {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  z.uuid().parse(companyId);
  const db = createSupabaseAdmin();
  const [company, billing, contacts] = await Promise.all([
    db
      .from("companies")
      .select("name,city,country")
      .eq("id", companyId)
      .maybeSingle(),
    db
      .from("customer_billing_profiles")
      .select("profile")
      .eq("company_id", companyId)
      .maybeSingle(),
    db
      .from("contacts")
      .select("id,name,role,email")
      .eq("company_id", companyId)
      .order("created_at")
      .order("id"),
  ]);
  if (company.error || billing.error || contacts.error || !company.data)
    throw new Error("Company profile details could not be loaded.");
  const commerce = commerceDefaults(billing.data?.profile);
  const contact = contacts.data?.[0];
  return {
    commerce,
    contacts: (contacts.data ?? []).map((item) => ({
      ...item,
      name: item.name || "",
      role: item.role || "",
    })),
    customer: {
      companyName: company.data.name,
      contactId: contact?.id,
      contactName: contact?.name || "",
      contactRole: contact?.role || "",
      contactEmail: contact?.email || "",
      billingEmail: commerce.email || contact?.email || "",
      billingAddress:
        commerce.address ||
        [company.data.city, company.data.country].filter(Boolean).join(", "),
      taxId: commerce.taxId,
      phone: commerce.phone,
    },
  };
}

export async function searchPurchaseOrderProducts(
  search: string,
  page: number,
  currency: string,
) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const input = z
    .object({
      search: z.string().max(100),
      page: z.number().int().min(0).max(100000),
      currency: z.string().length(3),
    })
    .parse({ search, page, currency });
  return invoiceProducts(input.search, input.page, input.currency);
}

export async function loadPurchaseOrderProducts(skus: string[]) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const input = z.array(z.string().min(1).max(200)).max(100).parse(skus);
  if (!input.length) return { products: [], count: 0 };
  return invoiceProducts("", 0, "", input);
}

export async function listCompanyPurchaseOrders(companyId: string, page = 0) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  z.uuid().parse(companyId);
  z.number().int().min(0).max(100000).parse(page);
  const { data, error, count } = await createSupabaseAdmin()
    .from("purchase_orders")
    .select(
      "id,company_id,version,document,total_minor,created_at,invoices:invoices!invoices_purchase_order_id_fkey(id,number,status,total_minor,paid_minor,document)",
      {
        count: "exact",
      },
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .order("id")
    .range(page * 20, page * 20 + 19);
  if (error)
    throw new Error("Purchase orders could not be loaded. Please try again.");
  return {
    orders: (data ?? []).map((order) => ({
      ...order,
      document: purchaseOrderSchema.parse(order.document),
    })) as PurchaseOrder[],
    count: count ?? 0,
  };
}

export async function savePurchaseOrder(
  companyId: string,
  orderId: string | null,
  version: number,
  input: unknown,
): Promise<{ error?: string; success?: string; orderId?: string }> {
  const viewer = await requireWorkspaceMember([
    "admin",
    "operator",
    "bd_manager",
  ]);
  const ids = z
    .object({
      companyId: z.uuid(),
      orderId: z.uuid().nullable(),
      version: z.number().int().min(0),
    })
    .safeParse({ companyId, orderId, version });
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!ids.success || !parsed.success)
    return {
      error: parsed.error?.issues[0]?.message || "Invalid purchase order.",
    };
  const db = createSupabaseAdmin();
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError || !company)
    return { error: "This company could not be found." };
  if (!parsed.data.customer)
    parsed.data.customer = (await getPurchaseOrderProfile(companyId)).customer;
  const existing = orderId
    ? await db
        .from("purchase_orders")
        .select("document")
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle()
    : null;
  if (existing?.error || (orderId && !existing?.data))
    return { error: "The existing order could not be loaded." };
  const previous = existing?.data
    ? purchaseOrderSchema.parse(existing.data.document)
    : null;
  if (
    parsed.data.customer.contactId &&
    parsed.data.customer.contactId !== previous?.customer?.contactId
  ) {
    const contact = await db
      .from("contacts")
      .select("company_id")
      .eq("id", parsed.data.customer.contactId)
      .maybeSingle();
    if (contact.error || contact.data?.company_id !== companyId)
      return { error: "Select a contact belonging to this company." };
  }
  const changed = parsed.data.items.filter(
    (item, index) =>
      item.productSku &&
      (previous?.currency !== parsed.data.currency ||
        JSON.stringify(previous?.items[index]) !== JSON.stringify(item)),
  );
  const skus = [
    ...new Set(
      changed.flatMap((item) => (item.productSku ? [item.productSku] : [])),
    ),
  ];
  if (skus.length) {
    const products = await db
      .from("products")
      .select(invoiceProductSelect)
      .eq("active", true)
      .in("sku", skus);
    if (products.error)
      return {
        error: "Catalog products could not be checked. Please try again.",
      };
    const catalog = new Map(
      ((products.data ?? []) as InvoiceProductRow[]).map((row) => [
        row.sku,
        invoiceProduct(row),
      ]),
    );
    for (const item of changed) {
      const error = orderProductError(
        item,
        catalog.get(item.productSku!),
        parsed.data.currency,
      );
      if (error) return { error };
    }
  }
  const values = {
    document: parsed.data,
    reference: parsed.data.reference,
    total_minor: purchaseOrderTotal(parsed.data.items),
    updated_by: viewer.id,
    updated_at: new Date().toISOString(),
    version: version + 1,
  };
  const result = orderId
    ? await db
        .from("purchase_orders")
        .update(values)
        .eq("id", orderId)
        .eq("company_id", companyId)
        .eq("version", version)
        .select("id")
        .maybeSingle()
    : await db
        .from("purchase_orders")
        .insert({ ...values, company_id: companyId, created_by: viewer.id })
        .select("id")
        .single();
  if (result.error)
    return {
      error:
        result.error.code === "23505"
          ? "This PO number already exists for this company."
          : result.error.code === "P0001"
            ? result.error.message
            : "The purchase order could not be saved. Please try again.",
    };
  if (!result.data)
    return {
      error:
        "This PO was changed by another user. Close the editor and reload before editing again.",
    };
  revalidatePath(`/companies/${companyId}`);
  return { success: "Purchase order saved.", orderId: result.data.id };
}

export async function createOrderInvoice(
  companyId: string,
  orderId: string,
): Promise<{ invoiceId?: string; error?: string }> {
  const viewer = await requireWorkspaceMember([
    "admin",
    "operator",
    "bd_manager",
  ]);
  if (
    !z.uuid().safeParse(companyId).success ||
    !z.uuid().safeParse(orderId).success
  )
    return { error: "Invalid order." };
  const { data, error } = await createSupabaseAdmin()
    .from("purchase_orders")
    .select(
      "*,invoices:invoices!invoices_purchase_order_id_fkey(id,number,status,total_minor,paid_minor,document)",
    )
    .eq("id", orderId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data)
    return { error: "The customer order could not be loaded." };
  const order = {
    ...data,
    document: purchaseOrderSchema.parse(data.document),
  } as PurchaseOrder;
  if (["draft", "cancelled"].includes(order.document.status))
    return { error: "Confirm the order before creating an invoice." };
  const summary = orderBillingSummary(order);
  const items = order.document.items.flatMap((item, index) => {
    const remaining =
      item.quantity - (summary.quantities.get(orderLineId(index)) ?? 0);
    return remaining > 0
      ? [orderInvoiceItem(item, remaining, orderLineId(index))]
      : [];
  });
  if (!items.length)
    return {
      error:
        "All items are already invoiced or reserved in a draft. Open a linked invoice below.",
    };
  try {
    const seed = await invoiceBootstrap({ companyId });
    const po = order.document;
    const terms =
      po.paymentPolicy === "custom"
        ? `${po.preShipmentPercent}% payment before shipment. ${po.paymentTerms}`
        : "100% payment before shipment.";
    const document: InvoiceDocument = {
      ...applyOrderCustomerToInvoice(
        seed.document,
        po,
        seed.billing?.customer.contacts.map((contact) => contact.id) ?? [],
      ),
      purchaseOrderId: orderId,
      reference: po.reference,
      currency: po.currency,
      dueDate: seed.document.issueDate,
      shippingAddress: po.shippingAddress,
      shippingRecipient: po.shippingRecipient,
      shippingPhone: po.shippingPhone,
      items,
      notes: [`Payment terms: ${terms}`, po.notes]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 4000),
    };
    const invoice = await createInvoice(document, viewer.id);
    revalidatePath(`/companies/${companyId}`);
    return { invoiceId: invoice.id };
  } catch (error) {
    const issue = error as { code?: string; message?: string };
    return {
      error:
        issue.code === "P0001"
          ? issue.message
          : "Unable to create the invoice. Reload the order and try again.",
    };
  }
}
