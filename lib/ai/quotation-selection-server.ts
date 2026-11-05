import "server-only";
import type { WorkspaceViewer } from "../auth";
import type { WorkspaceAction } from "./workspace-assistant";
import type { AgentPlanningContext } from "./agent-actions";
import { AgentClarificationError } from "./agent-actions";
import { userProductRows } from "../data/product-personalization";
import { loadAgentEmails } from "./agent-records";
import { requireAiData } from "../data/ai-settings";
import { allQuotationProductsRequested, matchQuotationProducts } from "./quotation-selection";
import { splitQuotedEmail } from "../email-content";

async function requestedProducts(viewer: WorkspaceViewer, context: AgentPlanningContext, companyId?: string, sourceEmailId?: string, mailboxId?: string) {
  const products = (await userProductRows(viewer.id)).filter(product => product.active);
  const userText = context.messages.filter(message => message.role === "user").at(-1)?.content ?? "";
  const answer = matchQuotationProducts(userText, products);
  let matching = answer;
  const previousQuestion = context.messages.filter(message => message.role === "assistant").at(-1)?.content ?? "";
  const continuation = /clarify|which.*(?:product|grade)|no exact saved product match/i.test(previousQuestion) && !/\bonly\b/i.test(userText);
  const excludedSkus = [...answer.excludedSkus];
  const excludedTerms = [...answer.excludedTerms, ...[...userText.matchAll(/\b(?:exclude|without|remove|skip|no)\s+([a-z][a-z0-9+-]*)/gi)].map(match => match[1].toLowerCase().replaceAll("-", " "))];
  if ((!matching.productSkus.length && !matching.ambiguous.length) || continuation) {
    await requireAiData("emails", "customers", "products");
    const known = context.quotationSource;
    let text: string;
    let subject: string;
    if (known && (!companyId || known.companyId === companyId) && (!sourceEmailId || sourceEmailId === known.email.id) && known.email.contentAvailable && !known.email.truncated && known.email.text.trim()) {
      text = known.email.text; subject = known.email.subject;
    } else {
      const source = await loadAgentEmails(viewer, sourceEmailId, companyId, mailboxId);
      if (companyId && source.current && source.companyId !== companyId) throw new AgentClarificationError("Which customer's quotation should I prepare? The selected email belongs to a different or unmatched customer.");
      const inbound = source.current?.direction === "inbound" ? source.current : source.messages.filter(message => message.direction === "inbound").at(-1);
      if (!inbound || inbound.bodyLoaded === false || !inbound.body.trim()) throw new AgentClarificationError("Which products should I include? I could not read a customer email with their product requirements.");
      text = inbound.body; subject = inbound.subject;
    }
    matching = matchQuotationProducts(splitQuotedEmail(text).current, products);
    excludedSkus.push(...matching.excludedSkus); excludedTerms.push(...matching.excludedTerms);
    if (!matching.productSkus.length && !matching.ambiguous.length) matching = matchQuotationProducts(subject, products);
    if (continuation) {
      matching.productSkus = [...new Set([...matching.productSkus, ...answer.productSkus])];
      matching.ambiguous = [...matching.ambiguous, ...answer.ambiguous].filter(value => {
        const family = value.term.split(" ")[0].toLowerCase();
        const asked = previousQuestion.toLowerCase().includes(value.term.toLowerCase());
        return !(asked && answer.productSkus.some(sku => products.some(product => product.sku === sku && product.material?.toLowerCase() === family)));
      });
    }
  }
  matching.productSkus = matching.productSkus.filter(sku => !excludedSkus.includes(sku));
  matching.ambiguous = matching.ambiguous.filter(value => !excludedTerms.includes(value.term.toLowerCase().replaceAll("-", " ")));
  if (matching.ambiguous.length) throw new AgentClarificationError(`Please clarify ${matching.ambiguous.map(value => value.options.length ? `${value.term} (${value.options.slice(0, 5).join(", ")}${value.options.length > 5 ? ", more grades available" : ""})` : `${value.term} (no exact saved product match)`).join("; ")}. I will include only the customer's requested products.`);
  if (!matching.productSkus.length) throw new AgentClarificationError("Which products should I include? I could not match products from the customer's email. I will include all products only if you explicitly ask for all products.");
  return matching.productSkus;
}

/** Model-independent scope guard, applied before storing any proposal. */
export async function groundQuotationSelection(action: WorkspaceAction, viewer: WorkspaceViewer, context?: AgentPlanningContext): Promise<WorkspaceAction> {
  if (!context) return action;
  const all = allQuotationProductsRequested(context.messages);
  if (action.type === "crm_action" && (action.operation.op === "create_quotation" || action.operation.op === "create_catalog")) {
    const operation = action.operation;
    if (all) return { ...action, operation: operation.op === "create_quotation" ? { ...operation, allProducts: true, productSkus: [] } : { ...operation, productSkus: [] } };
    const skus = await requestedProducts(viewer, context, operation.companyId, operation.op === "create_quotation" ? operation.sourceEmailId : undefined, context.quotationSource?.mailboxId);
    if (operation.op === "create_quotation" && operation.items) {
      if (operation.items.some(item => !skus.includes(item.productSku))) throw new AgentClarificationError("The proposed quotation includes a product the customer did not request. Prepare it using only the products mentioned in their email or your explicit instructions.");
      return { ...action, operation: { ...operation, allProducts: false, productSkus: skus } };
    }
    return { ...action, operation: operation.op === "create_quotation" ? { ...operation, allProducts: false, productSkus: skus } : { ...operation, productSkus: skus } };
  }
  if ("email" in action && action.email?.attachCatalog) {
    const email = action.email;
    const skus = all ? undefined : await requestedProducts(viewer, context, context.quotationSource?.companyId ?? undefined, email.sourceEmailId, email.mailboxId);
    return { ...action, email: { ...email, catalogProductSkus: skus } } as WorkspaceAction;
  }
  return action;
}
