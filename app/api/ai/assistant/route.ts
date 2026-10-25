import { getWorkspaceViewer } from "@/lib/auth";
import { buildWorkspaceAssistantPrompt, extractWorkspaceActions, workspaceAssistantInstruction, workspaceAssistantSchema } from "@/lib/ai/workspace-assistant";
import { generateGeminiText } from "@/lib/ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "@/lib/ai/gateway";

export const maxDuration = 60;
const responseHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403, headers: responseHeaders });
  }
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers: responseHeaders });
  if (Number(request.headers.get("content-length")) > 90_000) {
    return Response.json({ error: "Start a new chat to continue." }, { status: 413, headers: responseHeaders });
  }
  const parsed = workspaceAssistantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || "Invalid assistant request." }, { status: 400, headers: responseHeaders });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const gatewayToken = process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim();
  if (!apiKey && !gatewayToken) {
    return Response.json({ error: "AI assistance is not configured. Ask your administrator to connect an AI provider." }, { status: 503, headers: responseHeaders });
  }
  const options = {
    systemInstruction: workspaceAssistantInstruction(parsed.data.mode, new Date().toISOString()),
    prompt: buildWorkspaceAssistantPrompt(parsed.data),
    maxOutputTokens: 1_400,
    fetcher: ((input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
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
    return Response.json(extractWorkspaceActions(output), { headers: responseHeaders });
  } catch {
    return Response.json({ error: "Filazoo AI could not respond. Please retry or ask an administrator to check the AI provider." }, { status: 502, headers: responseHeaders });
  }
}
