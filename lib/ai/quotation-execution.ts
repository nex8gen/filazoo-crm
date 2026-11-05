import "server-only";
import { revalidatePath } from "next/cache";
import type { WorkspaceViewer } from "../auth";
import { prepareNewQuotation, createQuotationDraft, quotationDetail, mutateQuotation } from "../data/quotations";
import { buildQuotation } from "../quotations";
import type { CrmOperation } from "./crm-tools";
import type { QuotationOperation } from "./quotation-tools";
import { invoiceBootstrap } from "../data/invoice-connections";

export function isQuotationOperation(operation: CrmOperation): operation is QuotationOperation {
  return ["create_quotation", "update_quotation", "quotation_lifecycle"].includes(operation.op);
}
export async function quotationTarget(operation: QuotationOperation, viewer: WorkspaceViewer) {
  if (operation.op === "create_quotation") {
    const prepared = await prepareNewQuotation(operation, viewer);
    return { name: prepared.customerName, value: prepared, preview: { kind: "Quotation", status: "draft", ...(prepared.document ? { document: prepared.document } : {}), currency: prepared.currency, products: prepared.products.map(product => ({ sku: product.sku, name: product.name })), effect: prepared.document ? "Create a priced quotation draft." : "Prepare a quotation for the selected products." } };
  }
  const detail = await quotationDetail(operation.quotationId, viewer);
  if (!detail.canWrite) throw new Error("You cannot change this quotation.");
  let document = detail.catalog.quote_document;
  if (operation.op === "update_quotation") {
    if (detail.catalog.quote_status !== "draft" || !detail.catalog.product_snapshot) throw new Error("Only a draft quotation with a saved product selection can be edited. Revise a shared quotation first.");
    const seed = document ? null : await invoiceBootstrap({ companyId: detail.catalog.company_id, userId: viewer.id });
    document = buildQuotation({ ...detail.initial, ...operation.changes }, detail.catalog.product_snapshot, document ?? { sellerName: seed!.document.sellerName, sellerAddress: seed!.document.sellerAddress, customerName: detail.catalog.company, issueDate: seed!.document.issueDate, currency: seed!.document.currency });
  }
  if (operation.op === "quotation_lifecycle" && operation.action === "convert" && detail.catalog.quote_status !== "accepted") throw new Error("Record real customer acceptance before converting a quotation to a draft order.");
  return { name: detail.catalog.company, value: { catalog: detail.catalog, document }, preview: { kind: "Quotation", document, status: detail.catalog.quote_status, revision: detail.catalog.quote_revision, ...(operation.op === "quotation_lifecycle" ? { action: operation.action, note: operation.note ?? null, effect: operation.action === "convert" ? "Create a draft order; no invoice is created." : "Update quotation status; no email is sent." } : {}) } };
}
export async function executeQuotationOperation(operation: QuotationOperation, viewer: WorkspaceViewer, actionId: string, current: { value: unknown; preview: Record<string, unknown> }) {
  if (operation.op === "create_quotation") {
    const saved = await createQuotationDraft(operation, viewer, actionId, current.value as Awaited<ReturnType<typeof prepareNewQuotation>>);
    revalidatePath("/company-quotations");
    return { success: "Draft quotation created.", quotationId: saved.id, href: `/company-quotations/${saved.id}` };
  }
  const detail = await quotationDetail(operation.quotationId, viewer);
  const revision = Number(current.preview.revision);
  if (detail.catalog.quote_revision !== revision) throw new Error("The quotation changed after approval. Prepare a fresh proposal.");
  const result = await mutateQuotation(operation.quotationId, operation.op === "update_quotation"
    ? { action: "save", revision, document: { ...detail.initial, ...operation.changes } }
    : { action: operation.action, revision, ...(operation.action === "accept" ? { note: operation.note } : {}), ...(operation.action === "convert" ? { allowCustomItems: operation.allowCustomItems } : {}) }, viewer);
  const id = result.newId || result.id;
  revalidatePath("/company-quotations"); revalidatePath(`/company-quotations/${operation.quotationId}`); revalidatePath(`/companies/${detail.catalog.company_id}`);
  return { success: result.orderId ? "Draft order created from the accepted quotation." : "Quotation updated.", quotationId: id, ...(result.orderId ? { orderId: result.orderId } : {}), href: result.orderId ? `/companies/${detail.catalog.company_id}/orders/${result.orderId}` : `/company-quotations/${id}` };
}
