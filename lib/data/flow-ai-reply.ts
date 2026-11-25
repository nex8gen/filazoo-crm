import { resolveGatewayTokenAsync, hasAiProvider } from "../ai/provider-credentials.ts";
import "server-only";
import { leadIntakeClassification, leadIntakeKindSchema, leadIntroduction } from "../lead-intake.ts";
import { requireAiAutomation } from "./ai-settings.ts";
import { aiBehaviorInstruction } from "../ai-policy.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { crmProduct, type CrmProductRow } from "../product-utils.ts";
import { invoiceProduct } from "../invoice-links.ts";
import { buildServerCatalogPdf } from "../catalog-pdf-server.ts";
import { generateGatewayText, type GatewayGeneration } from "../ai/gateway.ts";
import { flowReplyInstruction, resolveFlowReply, flowCatalogInstruction, resolveFlowCatalog, flowReplyContainsChinese, flowAuthoredText, explicitFlowCatalogRequest, flowCatalogAttached } from "../ai/flow-reply.ts";
import { applyEmailSignature, DEFAULT_EMAIL_COMPANY, DEFAULT_EMAIL_TITLE } from "../ai/email-rewrite.ts";
import type { JsonConfig } from "../flows.ts";
import { userProductRows } from "./product-personalization.ts";
import { requireWorkspaceMember } from "../auth.ts";
import { loadFlowInquiry, type FlowInquiry } from "./flow-inquiry.ts";
import { hydrateFlowMessages } from "./flow-mail-context.ts";

export function hasFlowReplyProvider() {
  return hasAiProvider(process.env);
}

export type FlowReplyMessage = { subject: string | null; body: string | null; body_loaded?: boolean; direction: string; message_id?: string | null; thread_id?: string | null; created_at: string };

export async function loadFlowReplyProducts(config: JsonConfig, userId?: string): Promise<CrmProductRow[]> {
  if (!config.useProducts && !config.attachCatalog) return [];
  const ownerId = userId ?? (await requireWorkspaceMember()).id;
  return (await userProductRows(ownerId)).filter((row) => row.active);
}

export async function prepareFlowTemplateCatalog(userId?: string) {
  const products = await loadFlowReplyProducts({ attachCatalog: true }, userId);
  if (!products.length) throw new Error("Add active products before sending a catalog.");
  const content = Buffer.from(await buildServerCatalogPdf(products.map(crmProduct), { title: "Product catalog" }));
  if (content.length > 7_500_000) throw new Error("The generated catalog exceeds the 7.5 MB attachment limit.");
  return [{ filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content }];
}

export async function prepareFlowAiReply({ userId, contactId, companyId, conversationId, config, inquiryBefore, inquiryOrigin, onGeneration }: {
  userId: string; contactId: string; companyId: string; conversationId: string; config: JsonConfig;
  inquiryBefore?: string; inquiryOrigin?: { source: string; id: string };
  onGeneration?: (generation: GatewayGeneration) => Promise<void>;
}) {
  const policy = await requireAiAutomation(["sending", ...(config.attachCatalog === true ? ["catalogs"] as const : [])], ["emails", "customers", "team", ...(config.nurture ? ["billing"] as const : []), ...(config.useProducts || config.attachCatalog ? ["products"] as const : [])]);
  if (!await resolveGatewayTokenAsync(process.env)) throw new Error("AI auto-reply is not configured. Add an AI provider in the server settings.");
  const admin = createSupabaseAdmin();
  const leadConversation = /^(company:|shopify:|lead:)/.test(conversationId);
  let messagesQuery = admin.from("emails").select("id,subject,body,direction,message_id,thread_id,created_at,body_loaded,mailbox_id,mailbox_uid,mailbox_uid_validity")
    .eq("contact_id", contactId).or(`owner_id.is.null,owner_id.eq.${userId}`).order("created_at", { ascending: false }).limit(201);
  if (!leadConversation) messagesQuery = messagesQuery.eq("thread_id", conversationId);
  else if (inquiryBefore) messagesQuery = messagesQuery.gte("created_at", inquiryBefore);
  const [messages, contact, company, manager, products, inquiry, purchaseHistory, knowledge] = await Promise.all([
    messagesQuery.throwOnError(),
    admin.from("contacts").select("name,email").eq("id", contactId).eq("company_id", companyId).single().throwOnError(),
    admin.from("companies").select("name,country,segment").eq("id", companyId).single().throwOnError(),
    admin.from("workspace_members").select("display_name").eq("user_id", userId).maybeSingle().throwOnError(),
    loadFlowReplyProducts(config, userId),
    inquiryBefore ? loadFlowInquiry(contactId, inquiryBefore, inquiryOrigin) : Promise.resolve(null),
    config.nurture ? admin.from("purchase_orders").select("document,total_minor,created_at").eq("company_id", companyId).not("document->>status", "in", "(draft,cancelled)").order("created_at", { ascending: false }).limit(5).throwOnError() : Promise.resolve({ data: [] }),
    policy.data.knowledge ? admin.from("email_reply_knowledge").select("title,content").order("created_at").limit(101).throwOnError() : Promise.resolve({ data: null }),
  ]);
  if ((messages.data?.length ?? 0) > 200 || (knowledge.data?.length ?? 0) > 100)
    throw new Error("AI reply needs manual review: the conversation or approved business knowledge exceeds the complete-context limit. No history was silently discarded.");
  const messageIds = (messages.data ?? []).flatMap(message => message.message_id ? [message.message_id] : []);
  const { data: deliveries } = messageIds.length ? await admin.from("mailbox_sent_messages").select("message_id,attachments,sent_at")
    .eq("user_id", userId).eq("to_email", contact.data.email.trim().toLowerCase()).eq("status", "sent").in("message_id", messageIds).throwOnError() : { data: [] };
  const catalogDeliveries = (deliveries ?? []).filter(message => flowCatalogAttached(message.attachments));
  return generateFlowAiReply({ usageUserId: userId, onGeneration, config, contact: contact.data, company: company.data, managerName: manager.data?.display_name || null,
    messages: await hydrateFlowMessages(messages.data ?? [], userId), productRows: products, previousAutomatedMessages: (messages.data ?? []).filter(message => message.direction === "sent").length,
    previousCatalogMessages: catalogDeliveries.length, approvedBusinessFacts: knowledge.data, inquiry, purchaseHistory: purchaseHistory.data });
}

export async function generateFlowAiReply({ usageUserId, config, contact, company, managerName, messages, productRows, previousAutomatedMessages, previousCatalogMessages, approvedBusinessFacts, inquiry, purchaseHistory, onGeneration }: {
  usageUserId?: string; config: JsonConfig; contact: { name: string | null; email: string }; company: { name: string; country?: string | null; segment?: string | null };
  managerName: string | null; messages: FlowReplyMessage[]; productRows: CrmProductRow[]; previousAutomatedMessages: number;
  inquiry?: FlowInquiry | null;
  purchaseHistory?: unknown;
  previousCatalogMessages?: number;
  approvedBusinessFacts?: Array<{ title: string; content: string }> | null;
  onGeneration?: (generation: GatewayGeneration) => Promise<void>;
}) {
  const token = await resolveGatewayTokenAsync(process.env);
  if (!token) throw new Error("AI auto-reply is not configured. Add an AI provider in the server settings.");
  const policy = await requireAiAutomation(["sending", ...(config.attachCatalog === true ? ["catalogs"] as const : [])], ["emails", "customers", "team", ...(config.nurture ? ["billing"] as const : []), ...(config.useProducts || config.attachCatalog ? ["products"] as const : [])]);
  const priceProducts = productRows.map((row) => invoiceProduct({ ...row, tags: row.tags ?? [] }));
  const catalogProducts = productRows.map(crmProduct);
  const orderedMessages = [...messages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (messages.some(message => message.body_loaded === false || message.body === null))
    throw new Error("AI reply needs manual review: complete conversation content is unavailable. Load the missing message before replying.");
  const history = [...orderedMessages].reverse().map((message) => {
    const body = flowAuthoredText(message.body || "");
    return { ...message, body, ...(body !== (message.body || "").trim() ? { quotedHistory: message.body } : {}) };
  });
  if (JSON.stringify({ history, inquiry, approvedBusinessFacts, productRows }).length > 250_000)
    throw new Error("AI reply needs manual review: the complete conversation and resources exceed the context limit. Earlier requirements have not been discarded.");
  const signal = AbortSignal.timeout(90_000);
  const firstIntroduction = config.leadIntake && !history.some(message => message.direction === "sent");
  const catalogMessageCount = previousCatalogMessages ?? (firstIntroduction ? 0 : previousAutomatedMessages);
  const generate = async (systemInstruction: string, prompt: string) => {
    const options = { systemInstruction: systemInstruction + aiBehaviorInstruction(policy, true), prompt, maxOutputTokens: 8192 };
    return generateGatewayText({ usageUserId, onGeneration, ...options, signal, token: token!, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim(), task: "reply", userText: config.instructions as string | undefined });
  };
  // Resolve the attachment before drafting so the email describes exactly what will be sent.
  const latestInbound = orderedMessages.find((message) => message.direction === "received");
  const catalogPrompt = JSON.stringify({
    task: "select_catalog_products", conversation: history, inquiry: inquiry ?? null,
    previouslyDeliveredCatalogs: previousCatalogMessages ?? null,
    firstAutomatedMessage: catalogMessageCount === 0 && config.catalogFirstMessageOnly !== false,
    products: catalogProducts.map((product) => ({ sku: product.sku, name: product.name, material: product.material,
      color: product.color, diameter: product.diameter, weight: product.weight })),
  });
  let selectedSkus: string[] = [];
  let catalogDecision: unknown = null;
  if (config.attachCatalog === true) {
    let output = await generate(flowCatalogInstruction, catalogPrompt);
    // A clear request must not silently become "none". Retry this decision once,
    // preserving scope/refusal checks; never fall back to unrelated products.
    if (latestInbound && explicitFlowCatalogRequest(latestInbound.body || "") && /"intent"\s*:\s*"none"/.test(output))
      output = await generate(`${flowCatalogInstruction} The authored latest message explicitly requests a catalog. Reassess that request; it must not be classified as none. Preserve exact product scope and exclusions.`, catalogPrompt);
    catalogDecision = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (latestInbound && explicitFlowCatalogRequest(latestInbound.body || "") && (catalogDecision as { intent: string }).intent === "none")
      throw new Error("AI reply needs manual review: the requested catalog was not selected. No email was sent.");
    selectedSkus = resolveFlowCatalog(output, config, catalogMessageCount, catalogProducts.map(product => product.sku), {
      products: catalogProducts, requestText: latestInbound ? flowAuthoredText(latestInbound.body || "") : Object.values(inquiry?.fields || {}).flat().join("\n"),
    });
  }
  const selectedProducts = catalogProducts.filter((product) => selectedSkus.includes(product.sku));
  const attachCatalog = selectedProducts.length > 0;
  const prompt = JSON.stringify({
    recipient: contact, company, ...(config.nurture ? { purchaseHistory: purchaseHistory ?? [] } : {}),
    conversation: history, inquiry: inquiry ?? null, managerGuidance: config.instructions || "", catalogAttached: attachCatalog, catalogDecision,
    approvedBusinessFacts: { status: !policy.data.knowledge ? "disabled" : approvedBusinessFacts ? "available" : "unavailable", records: policy.data.knowledge ? approvedBusinessFacts ?? [] : [] },
    attachedCatalogProducts: selectedProducts.map((product) => ({ sku: product.sku, name: product.name, material: product.material })),
    products: config.useProducts ? catalogProducts.map((product, index) => ({
      sku: product.sku, name: product.name, material: product.material, diameter: product.diameter,
      weight: product.weight, stockStatus: product.stockStatus, leadTime: product.leadTime, moq: product.moq,
      variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name })),
      ...(config.usePrices ? { pricing: priceProducts[index] } : {}),
    })) : [],
  });
  const instruction = flowReplyInstruction(config, attachCatalog);
  const intakeKind = firstIntroduction ? leadIntakeKindSchema.parse(JSON.parse((await generate(leadIntakeClassification, JSON.stringify({ conversation: history, inquiry: inquiry ?? null }))).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))).kind : null;
  let plan = intakeKind === "general"
    ? { subject: "Thank you for contacting Filazoo", body: leadIntroduction(typeof config.introductionTemplate === "string" ? config.introductionTemplate : undefined, contact.name, attachCatalog), quotes: [] }
    : await (async () => {
      try { return resolveFlowReply(await generate(instruction, prompt), priceProducts, config.usePrices === true); }
      catch (error) {
        if (!(error instanceof Error) || !/too many customer questions/.test(error.message)) throw error;
        return resolveFlowReply(await generate(`${instruction} The previous draft asked too many customer questions. Answer the request directly and ask zero questions when possible; otherwise ask for only one essential missing fact.`, prompt), priceProducts, config.usePrices === true);
      }
    })();
  const properNames = [contact.name || "", company.name, ...catalogProducts.flatMap((product) => [product.name, product.sku])];
  if (flowReplyContainsChinese(plan, properNames)) {
    plan = resolveFlowReply(await generate(`${instruction} Your previous draft contained Chinese prose. Regenerate the entire subject and body in English.`, prompt), priceProducts, config.usePrices === true);
    if (flowReplyContainsChinese(plan, properNames)) throw new Error("AI returned a non-English reply. No reply was sent.");
  }
  const body = applyEmailSignature(plan.body, { name: managerName || "Filazoo Sales Team", title: DEFAULT_EMAIL_TITLE, company: DEFAULT_EMAIL_COMPANY }, "en");
  const attachments = attachCatalog ? [{ filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content: Buffer.from(await buildServerCatalogPdf(selectedProducts, { title: "Product catalog", customer: company.name })) }] : [];
  if (attachments.some((attachment) => attachment.content.length > 7_500_000)) throw new Error("The generated catalog exceeds the 7.5 MB attachment limit.");
  const replySubject = config.replyInThread !== false && latestInbound?.subject && !/\p{Script=Han}/u.test(latestInbound.subject) ? `Re: ${latestInbound.subject.replace(/^re:\s*/i, "")}`.replace(/[\r\n]/g, " ").slice(0, 300) : plan.subject;
  return { ...plan, subject: replySubject, body, attachments, contextMessageId: latestInbound?.message_id ?? null, inReplyTo: config.replyInThread !== false ? latestInbound?.message_id : null, threadId: config.replyInThread !== false ? latestInbound?.thread_id : null };
}
