import { requireWorkspaceMember } from "@/lib/auth";
import { generateGeminiText } from "@/lib/ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "@/lib/ai/gateway";
import {
  applyEmailSignature,
  buildEmailRewriteInstruction,
  buildEmailRewritePrompt,
  DEFAULT_EMAIL_COMPANY,
  DEFAULT_EMAIL_TITLE,
  normalizeSignatureName,
} from "@/lib/ai/email-rewrite";
import { looksLikeEnglish, translateEnglishEmail } from "@/lib/email-translation";
import { z } from "zod";

const requestSchema = z.object({
  mode: z.enum(["rewrite", "translate"]),
  text: z.string().trim().min(1).max(20_000),
  context: z.string().max(8_000).optional(),
  recipient: z.string().max(200).optional(),
  assignedManagerName: z.string().max(200).optional(),
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
    pipelineStage: z.string().max(200).optional(),
    estimatedOrderQuantity: z.number().finite().optional(),
    estimatedValue: z.number().finite().optional(),
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
    return Response.json({ ok: false, error: "Enter text to translate or rewrite." }, { status: 400 });
  }

  const { mode, text, context, recipient, assignedManagerName, customerProfile, conversationHistory } = parsed.data;
  if (mode === "translate") {
    if (!looksLikeEnglish(text)) {
      return Response.json({ ok: true, output: text, skipped: true }, { headers: { "Cache-Control": "no-store" } });
    }
    try {
      const output = await translateEnglishEmail(text);
      return Response.json({ ok: true, output, provider: "mymemory" }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Translation is temporarily unavailable." }, { status: 502 });
    }
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const gatewayToken = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();

  const signature = {
    name: normalizeSignatureName(assignedManagerName, normalizeSignatureName(viewer.displayName)),
    title: DEFAULT_EMAIL_TITLE,
    company: DEFAULT_EMAIL_COMPANY,
  };
  const system = mode === "rewrite" ? buildEmailRewriteInstruction(signature) : "";
  const userContent = buildEmailRewritePrompt({
    recipient,
    managerInput: text,
    customerProfile,
    conversationHistory,
    legacyContext: context,
  });
  const finalizeOutput = (output: string) => mode === "rewrite" ? applyEmailSignature(output, signature) : output;

  const generateWithGateway = () => generateGatewayText({
    token: gatewayToken!,
    model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim(),
    systemInstruction: system,
    prompt: userContent,
  });

  if (!apiKey && !gatewayToken) {
    return Response.json({ ok: false, error: "AI writing is not configured." }, { status: 503 });
  }

  if (!apiKey && gatewayToken) {
    try {
      const output = finalizeOutput(await generateWithGateway());
      return Response.json({ ok: true, output, provider: "vercel-ai-gateway" }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "AI assistance is temporarily unavailable." }, { status: 502 });
    }
  }

  try {
    const output = finalizeOutput(await generateGeminiText({
      apiKey: apiKey!,
      model: process.env.GEMINI_EMAIL_MODEL?.trim(),
      systemInstruction: system,
      prompt: userContent,
    }));
    return Response.json({ ok: true, output, provider: "gemini" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (gatewayToken && isGeminiRegionError(error)) {
      try {
        const output = finalizeOutput(await generateWithGateway());
        return Response.json({ ok: true, output, provider: "vercel-ai-gateway" }, { headers: { "Cache-Control": "no-store" } });
      } catch (fallbackError) {
        return Response.json({ ok: false, error: fallbackError instanceof Error ? fallbackError.message : "AI assistance is temporarily unavailable." }, { status: 502 });
      }
    }
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "AI assistance is temporarily unavailable." }, { status: 502 });
  }
}
