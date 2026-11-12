import "server-only";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { documentConnectionError, type DocumentConnections, type DocumentConnectionContext } from "../document-connections.ts";
import type { DocumentCategory } from "../documents.ts";

export async function documentConnectionContext(viewer: WorkspaceViewer): Promise<DocumentConnectionContext> {
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    const [companies, products, orders, invoices] = await Promise.all([
      db.from("companies").select("id,name").order("name").limit(1000),
      db.from("products").select("sku,name,currency").eq("active", true).order("name").limit(1000),
      db.from("purchase_orders").select("id,number,company_id,reference,document,companies(name)").order("updated_at", { ascending: false }).limit(500),
      db.from("invoices").select("id,number,company_id,purchase_order_id,status").neq("status", "void").order("updated_at", { ascending: false }).limit(1000),
    ]);
    if ([companies, products, orders, invoices].some(result => result.error)) throw new Error("Unable to load related CRM records. Try again.");
    return { companies: companies.data!, products: products.data!, invoices: invoices.data!, orders: orders.data!.map(order => { const company = Array.isArray(order.companies) ? order.companies[0] : order.companies; return { id: order.id, number: order.number, company_id: order.company_id, reference: order.reference, company: company?.name ?? order.document?.customer?.companyName ?? "Customer", status: order.document?.status ?? "draft" }; }) };
  });
}

/** Resolve names and relationships on the server; never trust a client-supplied customer label. */
export async function validateDocumentConnections(db: ReturnType<typeof createSupabaseAdmin>, category: DocumentCategory, value: DocumentConnections) {
  const message = documentConnectionError(category, value);
  if (message) throw new Error(message);
  let companyId = value.company_id, productSkus = [...new Set(value.product_skus)];
  if (value.purchase_order_id) {
    const order = await db.from("purchase_orders").select("company_id,document").eq("id", value.purchase_order_id).maybeSingle();
    if (order.error || !order.data) throw new Error("This purchase order is unavailable in your workspace.");
    if (companyId && order.data.company_id !== companyId) throw new Error("The purchase order must belong to the selected customer.");
    companyId = order.data.company_id;
    if (["proforma", "invoice", "payment", "purchase_order"].includes(category)) productSkus = [...new Set<string>((order.data.document.items ?? []).flatMap((item: { productSku?: string }) => item.productSku ? [item.productSku] : []))];
  }
  if (value.invoice_id) {
    const invoice = await db.from("invoices").select("company_id,purchase_order_id,status").eq("id", value.invoice_id).maybeSingle();
    if (invoice.error || !invoice.data || invoice.data.status === "void") throw new Error("This invoice is unavailable.");
    if (!value.purchase_order_id || invoice.data.purchase_order_id !== value.purchase_order_id) throw new Error("Choose an invoice from the selected purchase order.");
    if (category === "proforma" && invoice.data.status !== "draft") throw new Error("Choose a draft invoice.");
    if (category === "invoice" && invoice.data.status !== "issued") throw new Error("Choose an issued commercial invoice.");
  }
  if (productSkus.length && !value.purchase_order_id) {
    const products = await db.from("products").select("sku").in("sku", productSkus);
    if (products.error || products.data?.length !== productSkus.length) throw new Error("One of these products is unavailable in your workspace.");
  }
  let company = "";
  if (companyId) {
    const found = await db.from("companies").select("name").eq("id", companyId).maybeSingle();
    if (found.error || !found.data) throw new Error("This customer is unavailable in your workspace.");
    company = found.data.name.slice(0, 160);
  }
  return { ...value, company_id: companyId, product_skus: productSkus, ...(companyId ? { company } : {}) };
}
