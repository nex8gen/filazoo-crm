import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { crmProduct, type CrmProductRow } from "../product-utils.ts";
import { invoiceProduct } from "../invoice-links.ts";
import { buildCatalogPdf } from "../catalog-pdf.ts";
import { generateGeminiText } from "../ai/gemini.ts";
import { generateGatewayText, isGeminiRegionError } from "../ai/gateway.ts";
import { flowReplyInstruction, resolveFlowReply, shouldAttachFlowCatalog } from "../ai/flow-reply.ts";
import { applyEmailSignature, DEFAULT_EMAIL_COMPANY, DEFAULT_EMAIL_TITLE } from "../ai/email-rewrite.ts";
import type { JsonConfig } from "../flows.ts";

export function hasFlowReplyProvider() {
  return Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

export type FlowReplyMessage = { subject: string | null; body: string | null; direction: string; message_id?: string | null; thread_id?: string | null; created_at: string };

export async function loadFlowReplyProducts(config: JsonConfig): Promise<CrmProductRow[]> {
  if (!config.useProducts && !config.attachCatalog) return [];
  const products: CrmProductRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data } = await createSupabaseAdmin().from("products")
      .select("sku,name,image_url,material,color,diameter,weight,price,currency,moq,stock_status,lead_time,tags,active,sheet_updated_at")
      .eq("active", true).order("sku").range(offset, offset + 499).throwOnError();
    products.push(...((data ?? []) as CrmProductRow[]).filter((row) => !row.sku.startsWith("SAMPLE-") && !row.name.toLowerCase().startsWith("[sample]")));
    if (!data || data.length < 500) return products;
  }
}

export async function prepareFlowTemplateCatalog() {
  const products = await loadFlowReplyProducts({ attachCatalog: true });
  if (!products.length) throw new Error("Add active products before sending a catalog.");
  const content = Buffer.from(buildCatalogPdf(products.map(crmProduct), { title: "Filazoo product catalog" }));
  if (content.length > 7_500_000) throw new Error("The generated catalog exceeds the 7.5 MB attachment limit.");
  return [{ filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content }];
}

export async function prepareFlowAiReply({ userId, contactId, companyId, conversationId, config }: {
  userId: string; contactId: string; companyId: string; conversationId: string; config: JsonConfig;
}) {
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
    loadFlowReplyProducts(config),
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
  const attachCatalog = shouldAttachFlowCatalog(config, previousAutomatedMessages);
  if (attachCatalog && !productRows.length) throw new Error("Add active products before attaching an AI reply catalog.");
  const priceProducts = productRows.map((row) => invoiceProduct({ ...row, tags: row.tags ?? [] }));
  const catalogProducts = productRows.map(crmProduct);
  const history = [...messages].reverse().map((message) => ({ ...message, body: (message.body || "").slice(0, 6000) }));
  const prompt = JSON.stringify({
    recipient: contact, company,
    conversation: history, managerGuidance: config.instructions || "", catalogAttached: attachCatalog,
    products: config.useProducts ? catalogProducts.map((product, index) => ({
      sku: product.sku, name: product.name, material: product.material, diameter: product.diameter,
      weight: product.weight, stockStatus: product.stockStatus, leadTime: product.leadTime, moq: product.moq,
      variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name })),
      ...(config.usePrices ? { pricing: priceProducts[index] } : {}),
    })) : [],
  });
  const options = { systemInstruction: flowReplyInstruction(config, attachCatalog), prompt, maxOutputTokens: 8192 };
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  const gateway = () => generateGatewayText({ ...options, token: token!, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim() });
  let output: string;
  try {
    output = apiKey ? await generateGeminiText({ ...options, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() }) : await gateway();
  } catch (error) {
    if (!apiKey || !token || !isGeminiRegionError(error)) throw error;
    output = await gateway();
  }
  const plan = resolveFlowReply(output, priceProducts, config.usePrices === true);
  const latestInbound = messages.find((message) => message.direction === "received");
  const language = config.language === "zh-CN" || (config.language === "auto" && /[\u3400-\u9fff]/.test(plan.body)) ? "zh-CN" : "en";
  const body = applyEmailSignature(plan.body, { name: managerName || "Filazoo Sales Team", title: DEFAULT_EMAIL_TITLE, company: DEFAULT_EMAIL_COMPANY }, language);
  const attachments = attachCatalog ? [{ filename: "Filazoo-product-catalog.pdf", contentType: "application/pdf", content: Buffer.from(buildCatalogPdf(catalogProducts, { title: "Filazoo product catalog", customer: company.name })) }] : [];
  if (attachments.some((attachment) => attachment.content.length > 7_500_000)) throw new Error("The generated catalog exceeds the 7.5 MB attachment limit.");
  const replySubject = config.replyInThread !== false && latestInbound?.subject ? `Re: ${latestInbound.subject.replace(/^re:\s*/i, "")}`.replace(/[\r\n]/g, " ").slice(0, 300) : plan.subject;
  return { ...plan, subject: replySubject, body, attachments, inReplyTo: config.replyInThread !== false ? latestInbound?.message_id : null, threadId: config.replyInThread !== false ? latestInbound?.thread_id : null };
}
