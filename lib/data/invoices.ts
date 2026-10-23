import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import {
  invoiceTotals,
  type Invoice,
  type InvoiceDocument,
  type InvoiceReceivable,
} from "../invoices";
import { validateInvoiceConnections } from "./invoice-connections";

export async function listInvoices(
  page = 0,
  search = "",
  status = "",
  companyId?: string,
) {
  let query = createSupabaseAdmin()
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
  return {
    invoices: data as Invoice[],
    count: count ?? 0,
    summary: summary.data as InvoiceReceivable[],
  };
}

export async function getInvoice(id: string) {
  const { data, error } = await createSupabaseAdmin()
    .from("invoices")
    .select("*,invoice_payments(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as Invoice | null;
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
