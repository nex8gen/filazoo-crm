import "server-only";
import { createSupabaseAdmin } from "../supabase/admin";
import { invoiceTotals, type Invoice, type InvoiceDocument } from "../invoices";

export async function listInvoices(page = 0, search = "", status = "") {
  let query = createSupabaseAdmin()
    .from("invoices")
    .select("*", { count: "exact" })
    .order("number", { ascending: false });
  if (search)
    query = query.ilike(
      "document->>customerName",
      `%${search.replace(/[%_\\]/g, "")}%`,
    );
  if (["draft", "issued", "void"].includes(status))
    query = query.eq("status", status);
  const { data, error, count } = await query.range(page * 25, page * 25 + 24);
  if (error) throw error;
  return { invoices: data as Invoice[], count: count ?? 0 };
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
  const { data, error } = await createSupabaseAdmin().rpc("mutate_invoice", {
    p_id: id,
    p_actor: userId,
    p_input: input,
  });
  if (error) throw error;
  return data;
}
