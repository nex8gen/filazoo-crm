import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import {
  invoiceTotals,
  type Invoice,
  type InvoiceDocument,
  type InvoiceReceivable,
} from "../invoices";
import {
  invoiceProductSelect,
  validateInvoiceConnections,
} from "./invoice-connections";
import {
  invoiceProduct,
  withInvoiceProductImages,
  type InvoiceProductRow,
} from "../invoice-links";
import { resolveMemberAvatars } from "./member-avatars";
import { customerPortalUrl } from "../customer-portal-links";

export async function listInvoices(
  page = 0,
  search = "",
  status = "",
  companyId?: string,
) {
  const admin = createSupabaseAdmin();
  let query = admin
    .from("invoices")
    .select("*", { count: "exact" })
    .order("number", { ascending: false });
  if (companyId) query = query.eq("company_id", companyId);
  if (search)
    query = query.ilike(
      "document->>customerName",
      `%${search.replace(/[%_\\]/g, "")}%`,
    );
  if (["draft", "issued", "void"].includes(status))
    query = query.eq("status", status);
  const [{ data, error, count }, summary] = await Promise.all([
    query.range(page * 25, page * 25 + 24),
    createSupabaseAdmin().rpc("invoice_receivables", {
      p_company_id: companyId ?? null,
      p_search: search.replace(/[%_\\]/g, ""),
      p_status: status,
    }),
  ]);
  if (error) throw error;
  if (summary.error) throw summary.error;
  const invoices = (data ?? []) as Invoice[];
  const creatorIds = [...new Set(invoices.flatMap((invoice) => invoice.created_by ? [invoice.created_by] : []))];
  const creators = new Map<string, { name?: string; avatarUrl?: string }>();
  if (creatorIds.length) {
    const { data: members, error: membersError } = await admin.from("workspace_members").select("user_id,display_name").in("user_id", creatorIds);
    if (membersError) throw membersError;
    for (const member of members ?? []) creators.set(member.user_id, { name: member.display_name || undefined });
    const avatars = await resolveMemberAvatars(admin, creatorIds);
    for (const [id, avatarUrl] of avatars) creators.set(id, { ...creators.get(id), avatarUrl });
  }
  return {
    invoices: invoices.map((invoice) => {
      const creator = invoice.created_by ? creators.get(invoice.created_by) : undefined;
      return { ...invoice, customer_portal_url: customerPortalUrl(invoice), creator_name: invoice.creator_name || creator?.name || (invoice.created_by ? "Workspace member" : "Creator not recorded"), creator_avatar_url: creator?.avatarUrl };
    }),
    count: count ?? 0,
    summary: summary.data as InvoiceReceivable[],
  };
}

export async function getInvoice(id: string) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("invoices")
    .select("*,invoice_payments(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const invoice = data as Invoice;
  invoice.customer_portal_url = customerPortalUrl(invoice);
  const skus = [
    ...new Set(
      invoice.document.items.flatMap((item) =>
        !item.imageUrl && item.productSku ? [item.productSku] : [],
      ),
    ),
  ];
  if (!skus.length) return invoice;
  const products = await admin
    .from("products")
    .select(invoiceProductSelect)
    .in("sku", skus);
  if (products.error) throw products.error;
  return {
    ...invoice,
    document: withInvoiceProductImages(
      invoice.document,
      ((products.data as InvoiceProductRow[]) ?? []).map(invoiceProduct),
    ),
  };
}

export async function createInvoice(document: InvoiceDocument, userId: string, id?: string) {
  await validateInvoiceConnections(document);
  const { data, error } = await createSupabaseAdmin()
    .from("invoices")
    .insert({
      ...(id ? { id } : {}),
      document,
      total_minor: invoiceTotals(document).total,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  const invoice = data as Invoice;
  return { ...invoice, customer_portal_url: customerPortalUrl(invoice) };
}

export async function mutateInvoice(
  id: string,
  userId: string,
  input: Record<string, unknown>,
) {
  if (input.action === "save")
    await validateInvoiceConnections(input.document as InvoiceDocument);
  const { data, error } = await createSupabaseAdmin().rpc("mutate_invoice", {
    p_id: id,
    p_actor: userId,
    p_input: input,
  });
  if (error) throw error;
  return data ? { ...data, customer_portal_url: customerPortalUrl(data as Invoice) } : data;
}
