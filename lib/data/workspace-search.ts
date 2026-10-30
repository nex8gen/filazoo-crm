import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { personalizeProductRows, type PersonalProductOverride } from "../product-personalization.ts";
import { normalizeWorkspaceSearch, validWorkspaceSearch, workspaceSearchFilter, searchInvoiceNumber, rankWorkspaceResults, type WorkspaceSearchKind, type WorkspaceSearchResult, type WorkspaceSearchResponse } from "../workspace-search.ts";

type Relation<T> = T | T[] | null;
const first = <T,>(value: Relation<T>) => Array.isArray(value) ? value[0] ?? null : value;
type Company = { id: string; name: string };
type Invoice = { id: string; number: number; company_id: string | null; customer_name: string; reference: string; companies?: Relation<Company> };
type Product = { sku: string; name: string; active: boolean };
type QueryResult = { data: unknown[] | null; error: unknown };
async function rows<T>(query: PromiseLike<QueryResult>): Promise<T[]> {
  const result = await query;
  if (result.error) throw new Error("Record search source unavailable");
  return (result.data ?? []) as T[];
}

export async function readWorkspaceSearch(client: ReturnType<typeof createSupabaseAdmin>, viewer: { id: string; role: string }, input: string): Promise<WorkspaceSearchResponse> {
  const query = normalizeWorkspaceSearch(input);
  if (!validWorkspaceSearch(query)) throw new RangeError("Use 2-120 characters without wildcard symbols.");
  const signal = AbortSignal.timeout(10_000);
  const assigned = viewer.role === "bd_manager";
  const unavailable: WorkspaceSearchKind[] = [];
  const companyJoin = assigned ? "companies!inner(id,name,pipeline!inner(owner_id))" : "companies!inner(id,name)";
  async function source(kind: WorkspaceSearchKind, read: () => Promise<WorkspaceSearchResult[]>): Promise<WorkspaceSearchResult[]> {
    try { return await read(); } catch { unavailable.push(kind); return []; }
  }
  const companyHref = (id: string) => `/companies/${encodeURIComponent(id)}`;
  const invoiceFields = "id,number,company_id,customer_name:document->>customerName,reference:document->>reference";
  function invoiceQuery(creator = false) {
    let request = client.from("invoices").select(`${invoiceFields},${assigned && !creator ? companyJoin : "companies(id,name)"}`);
    if (assigned) request = creator ? request.eq("created_by", viewer.id) : request.eq("companies.pipeline.owner_id", viewer.id);
    const number = searchInvoiceNumber(query);
    return request.or(`${workspaceSearchFilter(["document->>customerName", "document->>reference"], query)}${number !== null ? `,number.eq.${number}` : ""}`)
      .order("number", { ascending: false }).limit(12).abortSignal(signal);
  }
  const groups = await Promise.all([
    source("company", async () => {
      let request = client.from("companies").select(`id,name,domain,website${assigned ? ",pipeline!inner(owner_id)" : ""}`)
        .or("source.is.null,source.neq.sample_seed").or(workspaceSearchFilter(["name", "domain", "website"], query));
      if (assigned) request = request.eq("pipeline.owner_id", viewer.id);
      return (await rows<Company & { domain: string | null; website: string | null }>(request.order("name").order("id").limit(12).abortSignal(signal)))
        .map(row => ({ id: row.id, kind: "company", title: row.name, detail: row.domain || row.website || "Company profile", href: companyHref(row.id) }));
    }),
    source("contact", async () => {
      let request = client.from("contacts").select(`id,name,email,company_id,${companyJoin}`)
        .or(workspaceSearchFilter(["name", "email"], query));
      if (assigned) request = request.eq("companies.pipeline.owner_id", viewer.id);
      return (await rows<{ id: string; name: string | null; email: string; company_id: string; companies: Relation<Company> }>(request.order("name").order("id").limit(12).abortSignal(signal)))
        .map(row => ({ id: row.id, kind: "contact", title: row.name || row.email, detail: [row.email, first(row.companies)?.name].filter(Boolean).join(" · "), href: companyHref(row.company_id) }));
    }),
    source("invoice", async () => {
      const invoices = (await Promise.all([rows<Invoice>(invoiceQuery()), ...(assigned ? [rows<Invoice>(invoiceQuery(true))] : [])])).flat();
      return invoices.map(row => ({ id: row.id, kind: "invoice", title: `INV-${String(row.number).padStart(6, "0")}`, detail: [row.customer_name, row.reference].filter(Boolean).join(" · "), href: `/invoices/${encodeURIComponent(row.id)}` }));
    }),
    source("order", async () => {
      let request = client.from("purchase_orders").select(`id,company_id,reference:document->>reference,${companyJoin}`)
        .or(workspaceSearchFilter(["document->>reference"], query));
      if (assigned) request = request.eq("companies.pipeline.owner_id", viewer.id);
      return (await rows<{ id: string; company_id: string; reference: string; companies: Relation<Company> }>(request.order("created_at", { ascending: false }).order("id").limit(12).abortSignal(signal)))
        .map(row => ({ id: row.id, kind: "order", title: row.reference, detail: first(row.companies)?.name || "Customer purchase order", href: `${companyHref(row.company_id)}?tab=purchase-orders&orderId=${encodeURIComponent(row.id)}` }));
    }),
    source("product", async () => {
      const [base, namedOverrides] = await Promise.all([
        rows<Product>(client.from("products").select("sku,name,active").not("sku", "like", "SAMPLE-%")
          .or(workspaceSearchFilter(["sku", "name"], query)).order("sku").limit(12).abortSignal(signal)),
        rows<PersonalProductOverride & { products: Relation<Product> }>(client.from("user_product_overrides").select("product_sku,data,updated_at,products!inner(sku,name,active)")
          .eq("user_id", viewer.id).or(workspaceSearchFilter(["product_sku", "data->>name"], query)).order("product_sku").limit(12).abortSignal(signal)),
      ]);
      const candidates = [...new Map([...base, ...namedOverrides.flatMap(row => first(row.products) ? [first(row.products)!] : [])].map(row => [row.sku, row])).values()];
      const overrides = candidates.length ? await rows<PersonalProductOverride>(client.from("user_product_overrides").select("product_sku,data,updated_at")
        .eq("user_id", viewer.id).in("product_sku", candidates.map(row => row.sku)).order("product_sku").limit(24).abortSignal(signal)) : [];
      return personalizeProductRows(candidates, overrides).filter(row => row.active && !row.sku.startsWith("SAMPLE-") && !row.name.toLowerCase().startsWith("[sample]")
        && `${row.sku} ${row.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .map(row => ({ id: row.sku, kind: "product", title: row.name, detail: row.sku, href: `/catalogs/products/${encodeURIComponent(row.sku)}` }));
    }),
    source("task", async () => (await rows<{ id: string; title: string; status: string; companies: Relation<Company> }>(client.from("crm_tasks")
      .select("id,title,status,companies(id,name)").eq("assigned_to", viewer.id).or(workspaceSearchFilter(["title"], query))
      .order("updated_at", { ascending: false }).order("id").limit(12).abortSignal(signal)))
      .map(row => ({ id: row.id, kind: "task", title: row.title, detail: [first(row.companies)?.name, row.status].filter(Boolean).join(" · "), href: `/tasks?task=${encodeURIComponent(row.id)}` }))),
    source("shipment", async () => {
      let request = client.from("customer_portal_shipments")
        .select(`invoice_id,tracking_number,carrier,invoices!inner(id,company_id,customer_name:document->>customerName${assigned ? ",companies!inner(pipeline!inner(owner_id))" : ""})`)
        .or(workspaceSearchFilter(["tracking_number"], query));
      if (assigned) request = request.eq("invoices.companies.pipeline.owner_id", viewer.id);
      return (await rows<{ invoice_id: string; tracking_number: string; carrier: string; invoices: Relation<Pick<Invoice, "company_id" | "customer_name">> }>(request.order("updated_at", { ascending: false }).order("invoice_id").limit(12).abortSignal(signal)))
        .map(row => { const invoice = first(row.invoices); return { id: row.invoice_id, kind: "shipment", title: row.tracking_number, detail: [row.carrier, invoice?.customer_name].filter(Boolean).join(" · "),
          href: invoice?.company_id ? `${companyHref(invoice.company_id)}?tab=customer-portal&invoiceId=${encodeURIComponent(row.invoice_id)}` : `/invoices/${encodeURIComponent(row.invoice_id)}` }; });
    }),
  ]);
  return { query, results: rankWorkspaceResults(groups.flat(), query), unavailable: workspaceSearchLabelsOrder(unavailable) };
}
function workspaceSearchLabelsOrder(kinds: WorkspaceSearchKind[]) {
  return [...new Set(kinds)].sort();
}
export async function searchWorkspace(input: string) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return readWorkspaceSearch(createSupabaseAdmin(), viewer, input);
}
