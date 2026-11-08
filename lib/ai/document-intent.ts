import type { WorkspaceAction } from "./workspace-assistant.ts";

type Conversation = { messages?: ReadonlyArray<{ role: string; content: string }> };
const kinds = {
  quotation: /\b(?:quotation|quotations|quote|quotes|quatation|qatation|cotation|qutation|qotation|qutoatino|qatatino|catalog|catalogue|catelog|catalogs)\b|报价单|報價單|产品目录|產品目錄/iu,
  invoice: /\b(?:invoice|invoices|invioce|inovice)\b|发票|發票/iu,
  order: /\b(?:purchase\s+order|sales\s+order|order|orders)\b|采购单|採購單|订单|訂單/iu,
};
export function requestedDocumentKinds(context?: Conversation) {
  for (const message of [...context?.messages ?? []].reverse()) {
    if (message.role !== "user") continue;
    const content = message.content.replace(/\b(?:not|no|without|don't create|do not create)\s+(?:an?\s+)?(?:invoice|invioce|inovice|quotation|quote|catalog|catelog|order)\b/giu, "");
    const found = Object.entries(kinds).filter(([, pattern]) => pattern.test(content)).map(([kind]) => kind);
    if (found.length) return found;
  }
  return [];
}
export function quotationEmailDraftRequested(context?: Conversation) {
  const latest = context?.messages?.filter(message => message.role === "user").at(-1)?.content ?? "";
  const requested = requestedDocumentKinds(context);
  return requested.length === 1 && requested[0] === "quotation" && /\b(?:email|e-mail|emial|mail)\b|邮件|郵件/iu.test(latest) && /\bdraft\b|草稿/iu.test(latest);
}
export function documentActionAllowed(name: string, context?: Conversation) {
  return !(quotationEmailDraftRequested(context) && ["create_quotation", "create_catalog", "create_invoice", "custom_invoice", "invoice_order"].includes(name));
}
/** Business intent is checked independently of provider prompts and tool syntax. */
export function assertDocumentIntent(actions: WorkspaceAction[], context?: Conversation) {
  const requested = requestedDocumentKinds(context);
  if (!requested.length) return;
  for (const action of actions) {
    const name = action.type === "crm_action" ? action.operation.op : action.type;
    if (!documentActionAllowed(name, context)) throw new Error("For the requested quotation email draft, prepare one write_email with delivery:draft and attachCatalog:true. The CRM prepares its quotation attachment; do not create a separate document.");
    const kind = ["create_invoice", "update_invoice", "send_invoice", "custom_invoice", "invoice_order", "invoice_lifecycle"].includes(name) ? "invoice"
      : ["create_quotation", "update_quotation", "quotation_lifecycle"].includes(name) ? "quotation"
      : name === "save_order" || name === "create_order" ? "order" : name === "create_catalog" ? "quotation" : null;
    // An order is the CRM's required dependency for a new invoice. The
    // compound tool resolves it internally, without substituting a quotation.
    if (name === "create_order" && requested.includes("invoice")) continue;
    if (kind && !requested.includes(kind)) throw new Error(`You requested a ${requested.join(" or ")}. The agent proposed a different document (${kind}), so no actions were prepared. Please retry the original request.`);
  }
}
