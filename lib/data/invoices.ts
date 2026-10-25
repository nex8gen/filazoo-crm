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
import { AVATAR_PRESETS, ownAvatarPath, PROFILE_AVATAR_BUCKET } from "../profile-avatar";

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
    // Photo failures must not prevent the invoice list from loading. Resolve
    // each distinct creator once, and keep Auth metadata on the server.
    await Promise.allSettled(creatorIds.map(async (creatorId) => {
      const { data: user } = await admin.auth.admin.getUserById(creatorId);
      const metadata = user.user?.user_metadata;
      if (!metadata) return;
      const profile = creators.get(creatorId) ?? {};
      profile.avatarUrl = AVATAR_PRESETS.find((preset) => preset.id === metadata.avatar_preset)?.image;
      creators.set(creatorId, profile);
      const path = ownAvatarPath(creatorId, metadata.avatar_path);
      if (path) {
        const { data: photo } = await admin.storage.from(PROFILE_AVATAR_BUCKET).createSignedUrl(path, 3600);
        if (photo?.signedUrl) profile.avatarUrl = photo.signedUrl;
      }
    }));
  }
  return {
    invoices: invoices.map((invoice) => {
      const creator = invoice.created_by ? creators.get(invoice.created_by) : undefined;
      return { ...invoice, creator_name: invoice.creator_name || creator?.name || (invoice.created_by ? "Workspace member" : "Creator not recorded"), creator_avatar_url: creator?.avatarUrl };
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

export async function createInvoice(document: InvoiceDocument, userId: string) {
  await validateInvoiceConnections(document);
  const { data, error } = await createSupabaseAdmin()
    .from("invoices")
    .insert({
      document,
      total_minor: invoiceTotals(document).total,
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Invoice;
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
  return data;
}
