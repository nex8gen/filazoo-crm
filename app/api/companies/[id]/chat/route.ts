import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { getCompanyDetails } from "@/lib/data/crm";
import { buildCompanyChatContext, buildCompanyChatPrompt, citedCompanySources, companyChatInstruction, companyChatSchema } from "@/lib/ai/company-chat";
import { generateGeminiText } from "@/lib/ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "@/lib/ai/gateway";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  }
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid customer." }, { status: 400, headers });
  if (Number(request.headers.get("content-length")) > 140_000) return Response.json({ error: "Start a new chat to continue." }, { status: 413, headers });
  const parsed = companyChatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Invalid chat request." }, { status: 400, headers });

  let details;
  try {
    ({ details } = await getCompanyDetails(id));
  } catch {
    return Response.json({ error: "Unable to load this customer's records. Please try again." }, { status: 503, headers });
  }
  if (!details) return Response.json({ error: "Customer not found." }, { status: 404, headers });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const gatewayToken = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!apiKey && !gatewayToken) return Response.json({ error: "AI assistance is not configured. Ask your administrator to connect an AI provider." }, { status: 503, headers });
  const { context, sources } = buildCompanyChatContext(details, viewer.role !== "bd_manager");
  const options = {
    systemInstruction: companyChatInstruction(new Date().toISOString()),
    prompt: buildCompanyChatPrompt(context, parsed.data.messages),
    maxOutputTokens: 1_600,
    fetcher: ((input, init) => fetch(input, {
      ...init, signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    })) as typeof fetch,
  };
  const gateway = () => generateGatewayText({ ...options, token: gatewayToken!, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim() });
  try {
    let output: string;
    if (apiKey) {
      try {
        output = await generateGeminiText({ ...options, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() });
      } catch (error) {
        if (!gatewayToken || !isGeminiRegionError(error)) throw error;
        output = await gateway();
      }
    } else output = await gateway();
    return Response.json({ output, sources: citedCompanySources(output, sources), coverage: context.coverage }, { headers });
  } catch {
    return Response.json({ error: "The customer assistant could not respond. Please retry. If this continues, ask your administrator to check the AI provider's key, quota and regional availability." }, { status: 502, headers });
  }
}
