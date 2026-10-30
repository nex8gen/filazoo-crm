import "server-only";
import { z } from "zod";
import { requireWorkspaceMember, type WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { invoiceBootstrap } from "./invoice-connections.ts";
import { userProductRows } from "./product-personalization.ts";
import { crmProduct } from "../product-utils.ts";
import { invoiceProduct, type InvoiceProductRow } from "../invoice-links.ts";
import { purchaseOrderSchema } from "../purchase-orders.ts";
import { quotationActionSchema, quotationDocumentSchema, quotationToday, quotationLabel, quotationOrder, quotationShareBlockers, buildQuotation, type QuotationRecord, type QuotationInput, type QuotationDetail } from "../quotations.ts";

export class QuotationError extends Error { constructor(message: string, public status = 409) { super(message); } }
const fields = "id,company_id,currency,version,product_skus,product_snapshot,quote_document,quote_status,quote_revision,quote_order_id,quote_previous_id,companies(name)";
export async function readQuotation(id: string, viewer: WorkspaceViewer): Promise<QuotationRecord> {
  if (!z.uuid().safeParse(id).success) throw new QuotationError("Invalid quotation ID.", 400);
  const { data, error } = await createSupabaseAdmin().from("catalogs").select(fields).eq("id", id).eq("user_id", viewer.id).maybeSingle();
  if (error) throw new QuotationError("Quotation setup is unavailable. Check the quotation database migration.", 503);
  if (!data) throw new QuotationError("Quotation not found in your account.", 404);
  const company = Array.isArray(data.companies) ? data.companies[0] : data.companies;
  return { ...data, company: company?.name || "Customer", currency: data.currency.trim(), product_skus: data.product_skus ?? [], product_snapshot: Array.isArray(data.product_snapshot) ? data.product_snapshot : null,
    quote_document: data.quote_document ? quotationDocumentSchema.parse(data.quote_document) : null } as QuotationRecord;
}
async function canChange(catalog: QuotationRecord, viewer: WorkspaceViewer) {
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) return false;
  if (viewer.role !== "bd_manager") return true;
  const { data, error } = await createSupabaseAdmin().from("pipeline").select("company_id").eq("company_id", catalog.company_id).eq("owner_id", viewer.id).maybeSingle();
  if (error) throw new QuotationError("Customer ownership could not be checked.", 503);
  return Boolean(data);
}
function draftInput(catalog: QuotationRecord, seed: Awaited<ReturnType<typeof invoiceBootstrap>> | null): QuotationInput {
  const doc = catalog.quote_document;
  const today = quotationToday();
  const validUntil = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  return {
    validUntil: doc?.validUntil ?? validUntil, customerEmail: doc?.customerEmail ?? seed?.document.customerEmail ?? "",
    billingAddress: doc?.billingAddress ?? seed?.document.customerAddress ?? "", taxId: doc?.taxId ?? seed?.document.customerTaxId ?? "",
    shippingAddress: doc?.shippingAddress ?? seed?.document.shippingAddress ?? "", shippingRecipient: doc?.shippingRecipient ?? seed?.document.shippingRecipient ?? "", shippingPhone: doc?.shippingPhone ?? seed?.document.shippingPhone ?? "",
    shippingMinor: doc?.shippingMinor ?? 0, shippingConfirmed: doc?.shippingConfirmed ?? false, preShipmentPercent: doc?.preShipmentPercent ?? 100, paymentTerms: doc?.paymentTerms ?? "", notes: doc?.notes ?? "",
    items: doc ? doc.items.map(({ productSku, variantId, quantity, pricingMode, unitPriceMinor }) => ({ productSku, ...(variantId ? { variantId } : {}), quantity, pricingMode, unitPriceMinor }))
      : (catalog.product_snapshot ?? []).map(product => ({ productSku: product.sku, ...(product.variants.length === 1 ? { variantId: product.variants[0].id } : {}), quantity: Math.max(1, product.moq ?? 1), pricingMode: "saved" as const })),
  };
}
export async function quotationDetail(id: string, viewer: WorkspaceViewer): Promise<QuotationDetail> {
  const catalog = await readQuotation(id, viewer);
  const canWrite = await canChange(catalog, viewer);
  const seed = canWrite && !catalog.quote_document ? await invoiceBootstrap({ userId: viewer.id, companyId: catalog.company_id }) : null;
  return { catalog, initial: draftInput(catalog, seed), canWrite };
}
export async function getQuotationDetail(id: string) {
  return quotationDetail(id, await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]));
}
export async function mutateQuotation(id: string, input: unknown, viewer: WorkspaceViewer) {
  const parsed = quotationActionSchema.safeParse(input);
  if (!parsed.success) throw new QuotationError("Check the quotation fields and try again.", 400);
  const action = parsed.data;
  const catalog = await readQuotation(id, viewer);
  if (!await canChange(catalog, viewer)) throw new QuotationError("You cannot change this quotation or its customer assignment.", 403);
  if (action.action !== "convert" && action.revision !== catalog.quote_revision) throw new QuotationError("This quotation changed. Reload it before continuing.");
  const db = createSupabaseAdmin();
  let document = null, order = null, snapshot = null;
  if (action.action === "save") {
    if (catalog.quote_status !== "draft") throw new QuotationError("Create a new version to change a shared or accepted quotation.");
    if (!catalog.product_snapshot) throw new QuotationError("Create a current version before preparing this older selection.");
    const existing = catalog.quote_document;
    const seed = existing ? null : await invoiceBootstrap({ userId: viewer.id, companyId: catalog.company_id });
    try {
      document = buildQuotation(action.document, catalog.product_snapshot, { sellerName: existing?.sellerName || seed?.document.sellerName || "Filazoo", sellerAddress: existing?.sellerAddress ?? seed?.document.sellerAddress ?? "", customerName: existing?.customerName || catalog.company, issueDate: existing?.issueDate || quotationToday(), currency: catalog.currency as "USD" });
    } catch (error) { throw new QuotationError(error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "Check the quotation amounts.", 400); }
  }
  if (action.action === "share") {
    const blockers = quotationShareBlockers(catalog.quote_document);
    if (blockers.length) throw new QuotationError(blockers.join(" "));
  }
  if (action.action === "revise" && !catalog.product_snapshot) {
    const products = await userProductRows(viewer.id, catalog.product_skus);
    if (!products.length || products.length !== catalog.product_skus.length || products.some(product => product.currency.trim() !== catalog.currency)) throw new QuotationError("Restore the original product selection in the same currency or create a new selection.");
    snapshot = products.map(crmProduct);
  }
  if (action.action === "convert" && !catalog.quote_order_id) {
    if (catalog.quote_status !== "accepted" || !catalog.quote_document) throw new QuotationError("Record customer acceptance before creating an order.");
    const { data: products, error } = await db.from("products").select("sku,name,image_url,currency,price,moq,color,tags,stock_status,active").in("sku", catalog.product_skus);
    if (error) throw new QuotationError("Current product links could not be checked.", 503);
    const current = new Map(((products ?? []) as InvoiceProductRow[]).filter(product => product.active).map(product => [product.sku, invoiceProduct(product)]));
    try {
      order = purchaseOrderSchema.parse(quotationOrder(catalog.quote_document, quotationLabel(catalog), line => {
        const product = current.get(line.productSku);
        return Boolean(product && product.currency === catalog.currency && (!line.variantId || product.variants.some(variant => variant.id === line.variantId && variant.sku === line.variantSku)));
      }, action.allowCustomItems));
    } catch (error) { throw new QuotationError(error instanceof z.ZodError ? error.issues[0].message : error instanceof Error ? error.message : "The draft order could not be prepared."); }
  }
  const { data, error } = await db.rpc("mutate_catalog_quotation", { p_id: id, p_actor: viewer.id, p_expected: action.revision, p_action: action.action, p_document: document, p_order: order,
    p_note: action.action === "accept" ? action.note : null, p_snapshot: snapshot });
  if (error) throw new QuotationError(error.code === "P0001" ? error.message : error.code === "23505" ? "This quotation already has a matching order. Reload before trying again." : "The quotation could not be saved. Please retry.", error.code === "P0001" || error.code === "23505" ? 409 : 503);
  return data as { id: string; revision: number; status: string; orderId: string | null; newId: string | null };
}
