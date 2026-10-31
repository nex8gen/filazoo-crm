import "server-only";
import { requireAiAutomation } from "./ai-settings.ts";
import { aiBehaviorInstruction } from "../ai-policy.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { crmProduct, type CrmProductRow } from "../product-utils.ts";
import { invoiceProduct } from "../invoice-links.ts";
import { buildServerCatalogPdf } from "../catalog-pdf-server.ts";
import { generateGeminiText } from "../ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../ai/gateway.ts";
import { flowReplyInstruction, resolveFlowReply, flowCatalogInstruction, resolveFlowCatalog, flowReplyContainsChinese } from "../ai/flow-reply.ts";
import { applyEmailSignature, DEFAULT_EMAIL_COMPANY, DEFAULT_EMAIL_TITLE } from "../ai/email-rewrite.ts";
import type { JsonConfig } from "../flows.ts";
import { userProductRows } from "./product-personalization.ts";
import { requireWorkspaceMember } from "../auth.ts";

export function hasFlowReplyProvider() {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

export type FlowReplyMessage = { subject: string | null; body: string | null; direction: string; message_id?: string | null; thread_id?: string | null; created_at: string };

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

export async function prepareFlowAiReply({ userId, contactId, companyId, conversationId, config }: {
  userId: string; contactId: string; companyId: string; conversationId: string; config: JsonConfig;
}) {
  await requireAiAutomation(["sending", ...(config.attachCatalog === true ? ["catalogs"] as const : [])], ["emails", "customers", "team", ...(config.useProducts || config.attachCatalog ? ["products"] as const : [])]);
  if (!hasFlowReplyProvider()) throw new Error("AI auto-reply is not configured. Add an AI provider in the server settings.");
  const admin = createSupabaseAdmin();
  const leadConversation = /^(company:|shopify:|lead:)/.test(conversationId);
  let messagesQuery = admin.from("emails").select("subject,body,direction,message_id,thread_id,created_at")
    .eq("contact_id", contactId).or(`owner_id.is.null,owner_id.eq.${userId}`).order("created_at", { ascending: false }).limit(12);
  if (!leadConversation) messagesQuery = messagesQuery.eq("thread_id", conversationId);
  const [messages, contact, company, manager, previousRuns, products] = await Promise.all([
    messagesQuery.throwOnError(),
    admin.from("contacts").select("name,email").eq("id", contactId).single().throwOnError(),
    admin.from("companies").select("name,country,segment").eq("id", companyId).single().throwOnError(),
    admin.from("workspace_members").select("display_name").eq("user_id", userId).maybeSingle().throwOnError(),
    admin.from("flow_runs").select("id").eq("contact_id", contactId).throwOnError(),
    loadFlowReplyProducts(config, userId),
  ]);
  const runIds = (previousRuns.data ?? []).map((run) => run.id);
  const { count: sentBefore } = runIds.length ? await admin.from("flow_run_logs").select("id", { count: "exact", head: true })
    .in("run_id", runIds).eq("result->>action", "email_sent").throwOnError() : { count: 0 };
  return generateFlowAiReply({ config, contact: contact.data, company: company.data, managerName: manager.data?.display_name || null,
    messages: messages.data ?? [], productRows: products, previousAutomatedMessages: sentBefore ?? 0 });
}

export async function generateFlowAiReply({ config, contact, company, managerName, messages, productRows, previousAutomatedMessages }: {
  config: JsonConfig; contact: { name: string | null; email: string }; company: { name: string; country?: string | null; segment?: string | null };
  managerName: string | null; messages: FlowReplyMessage[]; productRows: CrmProductRow[]; previousAutomatedMessages: number;
}) {
  if (!hasFlowReplyProvider()) throw new Error("AI auto-reply is not configured. Add an AI provider in the server settings.");
  const policy = await requireAiAutomation(["sending", ...(config.attachCatalog === true ? ["catalogs"] as const : [])], ["emails", "customers", "team", ...(config.useProducts || config.attachCatalog ? ["products"] as const : [])]);
  const priceProducts = productRows.map((row) => invoiceProduct({ ...row, tags: row.tags ?? [] }));
  const catalogProducts = productRows.map(crmProduct);
  const orderedMessages = [...messages].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const history = [...orderedMessages].reverse().map((message) => ({ ...message, body: (message.body || "").slice(0, 6000) }));
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  const generate = async (systemInstruction: string, prompt: string) => {
    const options = { systemInstruction: systemInstruction + aiBehaviorInstruction(policy, true), prompt, maxOutputTokens: 8192 };
    const gateway = () => generateGatewayText({ ...options, token: token!, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim() });
    try {
      return apiKey ? await generateGeminiText({ ...options, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() }) : await gateway();
    } catch (error) {
      if (!apiKey || !token || !isGeminiRegionError(error)) throw error;
      try { return await gateway(); }
      catch (fallbackError) {
        throw new Error(`Gemini is unavailable from this server location. The fallback provider also failed: ${fallbackError instanceof Error ? fallbackError.message : "Unknown provider error"}`);
      }
    }
  };
  // Resolve the attachment before drafting so the email describes exactly what will be sent.
  const selectedSkus = config.attachCatalog === true ? resolveFlowCatalog(await generate(flowCatalogInstruction, JSON.stringify({
    task: "select_catalog_products", conversation: history,
    firstAutomatedMessage: previousAutomatedMessages === 0 && config.catalogFirstMessageOnly !== false,
    products: catalogProducts.map((product) => ({ sku: product.sku, name: product.name, material: product.material,
      color: product.color, diameter: product.diameter, weight: product.weight })),
  })), config, previousAutomatedMessages, catalogProducts.map((product) => product.sku)) : [];
  const selectedProducts = catalogProducts.filter((product) => selectedSkus.includes(product.sku));
  const attachCatalog = selectedProducts.length > 0;
  const prompt = JSON.stringify({
    recipient: contact, company,
    conversation: history, managerGuidance: config.instructions || "", catalogAttached: attachCatalog,
    attachedCatalogProducts: selectedProducts.map((product) => ({ sku: product.sku, name: product.name, material: product.material })),
    products: config.useProducts ? catalogProducts.map((product, index) => ({
      sku: product.sku, name: product.name, material: product.material, diameter: product.diameter,
      weight: product.weight, stockStatus: product.stockStatus, leadTime: product.leadTime, moq: product.moq,
      variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name })),
      ...(config.usePrices ? { pricing: priceProducts[index] } : {}),
    })) : [],
  });
  const instruction = flowReplyInstruction(config, attachCatalog);
  let plan = resolveFlowReply(await generate(instruction, prompt), priceProducts, config.usePrices === true);
  const properNames = [contact.name || "", company.name, ...catalogProducts.flatMap((product) => [product.name, product.sku])];
  if (flowReplyContainsChinese(plan, properNames)) {
    plan = resolveFlowReply(await generate(`${instruction} Your previous draft contained Chinese prose. Regenerate the entire subject and body in English.`, prompt), priceProducts, config.usePrices === true);
    if (flowReplyContainsChinese(plan, properNames)) throw new Error("AI returned a non-English reply. No reply was sent.");
  }
  const latestInbound = orderedMessages.find((message) => message.direction === "received");
  const body = applyEmailSignature(plan.body, { name: managerName || "Filazoo Sales Team", title: DEFAULT_EMAIL_TITLE, company: DEFAULT_EMAIL_COMPANY }, "en");
  const attachments = attachCatalog ? [{ filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content: Buffer.from(await buildServerCatalogPdf(selectedProducts, { title: "Product catalog", customer: company.name })) }] : [];
  if (attachments.some((attachment) => attachment.content.length > 7_500_000)) throw new Error("The generated catalog exceeds the 7.5 MB attachment limit.");
  const replySubject = config.replyInThread !== false && latestInbound?.subject && !/\p{Script=Han}/u.test(latestInbound.subject) ? `Re: ${latestInbound.subject.replace(/^re:\s*/i, "")}`.replace(/[\r\n]/g, " ").slice(0, 300) : plan.subject;
  return { ...plan, subject: replySubject, body, attachments, inReplyTo: config.replyInThread !== false ? latestInbound?.message_id : null, threadId: config.replyInThread !== false ? latestInbound?.thread_id : null };
}
