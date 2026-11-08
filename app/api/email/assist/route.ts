import { resolveGatewayToken } from "@/lib/ai/provider-credentials";
import { requireAiFeature } from "@/lib/data/ai-settings";
import { aiBehaviorInstruction, restrictedAiContext, AiPolicyError } from "@/lib/ai-policy";
import { requireWorkspaceMember } from "@/lib/auth";
import { generateGatewayText } from "@/lib/ai/gateway";
import {
  applyEmailSignature,
  buildEmailRewriteInstruction,
  buildEmailRewritePrompt,
  DEFAULT_EMAIL_COMPANY,
  DEFAULT_EMAIL_TITLE,
  normalizeSignatureName,
} from "@/lib/ai/email-rewrite";
import { getEmailTranslationProvider, looksLikeEnglish, translateEmailSegments, translateEnglishEmail } from "@/lib/email-translation";
import { z } from "zod";
import { aiLanguageSchema } from "@/lib/ai/language";
import { buildEmailSummaryInstruction, generateEmailSummary } from "@/lib/ai/email-summary";
import { attachSummaryProducts, loadSummaryCatalog, summaryProductContext } from "@/lib/ai/email-summary-products";

const requestSchema = z.object({
  language: aiLanguageSchema,
  mode: z.enum(["rewrite", "translate", "summary"]),
  text: z.string().trim().min(1).max(20_000),
  subject: z.string().max(500).optional(),
  messageSource: z.enum(["mailbox", "shopify", "crm"]).optional(),
  segments: z.array(z.string().trim().min(1).max(20_000)).min(1).max(500)
    .refine((segments) => segments.reduce((length, text) => length + text.length, 0) <= 20_000, "Email is too long to translate.").optional(),
  context: z.string().max(8_000).optional(),
  recipient: z.string().max(200).optional(),
  assignedManagerName: z.string().max(200).optional(),
  currentFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  customerProfile: z.object({
    companyName: z.string().max(300),
    contactName: z.string().max(300).optional(),
    contactRole: z.string().max(300).optional(),
    website: z.string().max(500).optional(),
    country: z.string().max(200).optional(),
    city: z.string().max(200).optional(),
    segment: z.string().max(300).optional(),
    summary: z.string().max(4_000).optional(),
    interests: z.array(z.string().max(300)).max(30).optional(),
    fitScore: z.number().finite().optional(),
    currency: z.string().max(20).optional(),
  }).optional(),
  conversationHistory: z.array(z.object({
    direction: z.enum(["inbound", "outbound"]),
    subject: z.string().max(500).optional(),
    body: z.string().max(4_000),
    timestamp: z.string().max(100).optional(),
  })).max(12).optional(),
});

export async function POST(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid AI request. Check the message and conversation details." }, { status: 400 });
  }

  let policy;
  try { policy = await requireAiFeature("email", "emails"); }
  catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unable to verify AI access." }, { status: error instanceof AiPolicyError ? 403 : 503 }); }
  if (parsed.data.mode === "rewrite" && policy.actions.emailDrafts === "deny") return Response.json({ ok: false, error: "AI email drafting is blocked in Settings → AI access & behavior." }, { status: 403 });
  if (!policy.data.customers) parsed.data.customerProfile = undefined;
  if (!policy.data.billing && parsed.data.customerProfile) parsed.data.customerProfile.currency = undefined;
  if (!policy.data.team) parsed.data.assignedManagerName = undefined;
  if (!policy.data.tasks) parsed.data.currentFollowUpAt = undefined;
  if (restrictedAiContext(policy)) parsed.data.context = undefined;
  const { language, mode, text, context, recipient, assignedManagerName, customerProfile, conversationHistory } = parsed.data;
  if (mode === "translate") {
    if (parsed.data.segments) {
      try {
        const segments = await translateEmailSegments(parsed.data.segments);
        return Response.json({ ok: true, segments, provider: getEmailTranslationProvider() }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "Translation is temporarily unavailable." }, { status: error instanceof Error && error.name === "AiBudgetError" ? (error as Error & { status?: number }).status || 429 : 502 });
      }
    }
    if (!looksLikeEnglish(text)) {
      return Response.json({ ok: true, output: text, skipped: true }, { headers: { "Cache-Control": "no-store" } });
    }
    try {
      const output = await translateEnglishEmail(text);
      return Response.json({ ok: true, output, provider: getEmailTranslationProvider() }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Translation is temporarily unavailable." }, { status: error instanceof Error && error.name === "AiBudgetError" ? (error as Error & { status?: number }).status || 429 : 502 });
    }
  }

  const gatewayToken = resolveGatewayToken(process.env);

  const signature = {
    name: normalizeSignatureName(assignedManagerName, normalizeSignatureName(viewer.displayName)),
    title: DEFAULT_EMAIL_TITLE,
    company: DEFAULT_EMAIL_COMPANY,
  };
  const system = mode === "summary" ? `${buildEmailSummaryInstruction(language)}\nCURRENT TIME: ${new Date().toISOString()}\nWORKSPACE TIMEZONE: Asia/Shanghai` : buildEmailRewriteInstruction(signature);
  const governedSystem = system + aiBehaviorInstruction(policy, true);
  const catalog = mode === "summary" ? await loadSummaryCatalog(policy.data.products, async () => {
    const { listProducts } = await import("@/lib/data/crm");
    return listProducts(undefined, { requireComplete: true });
  }) : null;
  const userContent = mode === "summary" ? JSON.stringify({
    subject: parsed.data.subject,
    messageSource: parsed.data.messageSource,
    contact: recipient,
    customerProfile,
    conversationHistory,
    latestMessage: text,
    currentFollowUpAt: parsed.data.currentFollowUpAt,
    productCatalog: catalog ? summaryProductContext(catalog) : undefined,
  }) : buildEmailRewritePrompt({
    recipient,
    managerInput: text,
    customerProfile,
    conversationHistory,
    legacyContext: context,
  });
  const finalizeOutput = async (generate: (correction: string) => Promise<string>) => mode === "summary"
    ? attachSummaryProducts(await generateEmailSummary(generate, undefined, language), catalog!)
    : applyEmailSignature(await generate(""), signature);

  const generateWithGateway = (correction: string) => generateGatewayText({ usageUserId: viewer.id,
    task: "email", userText: text, complex: Boolean(correction), signal: request.signal,
    token: gatewayToken!,
    model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim(),
    systemInstruction: governedSystem,
    prompt: correction ? `${userContent}\n\nVALIDATION CORRECTION:\n${correction}` : userContent,
  });

  if (!gatewayToken) {
    return Response.json({ ok: false, error: "AI assistance is not configured." }, { status: 503 });
  }

  try {
    const output = await finalizeOutput(generateWithGateway);
    return Response.json({ ok: true, output, provider: "vercel-ai-gateway" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "AI assistance is temporarily unavailable." }, { status: error instanceof Error && error.name === "AiBudgetError" ? (error as Error & { status?: number }).status || 429 : 502 });
  }
}
