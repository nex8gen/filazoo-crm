import { translateUiText } from "@/lib/i18n";
import { getWorkspaceViewer } from "@/lib/auth";
import { buildWorkspaceAssistantPrompt, extractWorkspaceActions, workspaceAssistantInstruction, workspaceAssistantSchema } from "@/lib/ai/workspace-assistant";
import { generateGeminiText } from "@/lib/ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "@/lib/ai/gateway";
import { loadAgentContext } from "@/lib/ai/agent-context";
import { prepareAgentActions } from "@/lib/ai/agent-execution";
import { assistantProviderError } from "@/lib/ai/assistant-provider-error";

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
    systemInstruction: workspaceAssistantInstruction(parsed.data.mode, new Date().toISOString(), parsed.data.language),
    prompt: buildWorkspaceAssistantPrompt(parsed.data),
    maxOutputTokens: parsed.data.mode === "work" ? 5_000 : 1_400,
    fetcher: ((input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    })) as typeof fetch,
  };
  const agentMode = parsed.data.mode === "work";
  const gatewayModel = (agentMode ? process.env.AI_GATEWAY_AGENT_MODEL?.trim() : process.env.AI_GATEWAY_CHAT_MODEL?.trim()) || process.env.AI_GATEWAY_EMAIL_MODEL?.trim();
  const geminiModel = (agentMode ? process.env.GEMINI_AGENT_MODEL?.trim() : process.env.GEMINI_CHAT_MODEL?.trim()) || process.env.GEMINI_EMAIL_MODEL?.trim();
  const gateway = () => generateGatewayText({ ...options, token: gatewayToken!, model: gatewayModel });
  try {
    if (agentMode) options.prompt = buildWorkspaceAssistantPrompt(parsed.data, await loadAgentContext(parsed.data, viewer));
    let output: string;
    if (apiKey) {
      try {
        output = await generateGeminiText({ ...options, apiKey, model: geminiModel });
      } catch (error) {
        if (!gatewayToken || !isGeminiRegionError(error)) throw error;
        output = await gateway();
      }
    } else output = await gateway();
    const extracted = extractWorkspaceActions(output);
    if (!agentMode) return Response.json({ output: translateUiText(extracted.output, parsed.data.language), actions: [] }, { headers: responseHeaders });
    try {
      const actions = await prepareAgentActions(extracted.actions, viewer, parsed.data.approvalMode);
      return Response.json({ output: translateUiText(extracted.output || (actions.length ? "The requested actions are ready." : "Please describe the task you want me to carry out."), parsed.data.language), actions }, { headers: responseHeaders });
    } catch (error) {
      return Response.json({ output: translateUiText(error instanceof Error ? error.message : "Unable to prepare the requested action.", parsed.data.language), actions: [] }, { headers: responseHeaders });
    }
  } catch (error) {
    return Response.json({ error: assistantProviderError(error) }, { status: 502, headers: responseHeaders });
  }
}
