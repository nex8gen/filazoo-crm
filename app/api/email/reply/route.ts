import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { generateGeminiText } from "@/lib/ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "@/lib/ai/gateway";
import { emailReplyInstruction, parseEmailReplyPlan, replyProductSchema } from "@/lib/ai/email-reply";
import { applyEmailSignature, DEFAULT_EMAIL_COMPANY, DEFAULT_EMAIL_TITLE, normalizeSignatureName } from "@/lib/ai/email-rewrite";
import { canCreateInvoices } from "@/lib/invoice-permissions";

export const maxDuration = 60;
const schema = z.object({
  recipient: z.string().max(300),
  assignedManagerName: z.string().max(200).optional(),
  customerProfile: z.record(z.string(), z.unknown()).optional(),
  companyName: z.string().max(300),
  conversationHistory: z.array(z.object({
    direction: z.enum(["inbound", "outbound"]), subject: z.string().max(500).optional(),
    body: z.string().max(4_000), timestamp: z.string().max(100).optional(),
  })).min(1).max(12),
  products: z.array(replyProductSchema).max(500),
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid conversation details." }, { status: 400 });
  if (JSON.stringify(input.data).length > 200_000) return Response.json({ error: "Conversation context is too large." }, { status: 400 });
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const token = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!apiKey && !token) return Response.json({ error: "AI reply is not configured. Add an AI provider in the server settings." }, { status: 503 });
  const canCreateInvoice = canCreateInvoices(viewer.role);
  const prompt = JSON.stringify({ ...input.data, canCreateInvoice, seller: DEFAULT_EMAIL_COMPANY });
  const gateway = () => generateGatewayText({ token: token!, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim(), systemInstruction: emailReplyInstruction, prompt, maxOutputTokens: 8192 });
  try {
    let output: string;
    try {
      output = apiKey ? await generateGeminiText({ apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim(), systemInstruction: emailReplyInstruction, prompt, maxOutputTokens: 8192 }) : await gateway();
    } catch (error) {
      if (!apiKey || !token || !isGeminiRegionError(error)) throw error;
      output = await gateway();
    }
    const plan = parseEmailReplyPlan(output);
    if (!canCreateInvoice && plan.invoiceItems.length) throw new Error("Your role cannot create invoices. Ask an operator to prepare the invoice.");
    for (const item of plan.invoiceItems) {
      const product = input.data.products.find((value) => value.sku === item.productSku);
      if (!product || (item.variantId && !product.variants.some((variant) => variant.id === item.variantId)))
        throw new Error("AI could not match the requested product. Review the product and variant before retrying.");
    }
    plan.body = applyEmailSignature(plan.body, {
      name: normalizeSignatureName(input.data.assignedManagerName, normalizeSignatureName(viewer.displayName)),
      title: DEFAULT_EMAIL_TITLE, company: DEFAULT_EMAIL_COMPANY,
    });
    return Response.json({ ok: true, plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("AI reply generation failed", error);
    return Response.json({ error: error instanceof z.ZodError || error instanceof SyntaxError
      ? "AI returned an incomplete reply. Please try again."
      : error instanceof Error ? error.message : "Unable to prepare an AI reply." }, { status: 502 });
  }
}
