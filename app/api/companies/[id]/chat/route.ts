import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { getCompanyDetails } from "@/lib/data/crm";
import { buildCompanyChatContext, buildCompanyChatPrompt, citedCompanySources, companyChatInstruction, companyChatSchema } from "@/lib/ai/company-chat";
import { generateGeminiText } from "@/lib/ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "@/lib/ai/gateway";
import { researchCustomer } from "@/lib/ai/customer-research";
import { ChatBodyTooLargeError, collectChatImages, readChatRequestBody } from "@/lib/ai/image-input";
import { startChatSession } from "@/lib/ai/chat-session";
import { HistoryError } from "@/lib/ai/chat-history-server";

export const maxDuration = 120;
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
  let body: unknown;
  try { body = await readChatRequestBody(request); }
  catch (error) {
    return Response.json({ error: error instanceof ChatBodyTooLargeError ? error.message : "Unable to read this request." }, { status: error instanceof ChatBodyTooLargeError ? 413 : 400, headers });
  }
  const parsed = companyChatSchema.safeParse(body);
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
  let session: Awaited<ReturnType<typeof startChatSession>>;
  try {
    session = await startChatSession(parsed.data.history, { mode: "customer", pathname: `/companies/${id}`, pageContext: { companyId: id } }, viewer, parsed.data.messages.at(-1)!);
    if (session?.replay) return Response.json(session.replay, { headers });
    if (session) parsed.data.messages = session.messages;
  } catch (error) { return Response.json({ error: error instanceof HistoryError ? error.message : "Unable to open saved conversation." }, { status: error instanceof HistoryError ? error.status : 503, headers }); }
  const { context, sources } = buildCompanyChatContext(details, true);
  const options = {
    systemInstruction: companyChatInstruction(new Date().toISOString(), parsed.data.language, parsed.data.webSearch),
    prompt: buildCompanyChatPrompt(context, parsed.data.messages) + (session?.summaryPrompt ?? ""),
    images: collectChatImages(parsed.data.messages),
    maxOutputTokens: parsed.data.webSearch ? 2_600 : 1_600,
    fetcher: ((input, init) => (session?.fetcher ?? fetch)(input, {
      ...init, signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    })) as typeof fetch,
  };
  const gateway = () => generateGatewayText({ ...options, token: gatewayToken!, model: process.env.AI_GATEWAY_EMAIL_MODEL?.trim(), visionModel: process.env.AI_GATEWAY_VISION_MODEL?.trim() });
  try {
    const research = parsed.data.webSearch ? await researchCustomer({
      identity: { name: details.company.name, website: details.company.website, email: details.company.email, contact: details.company.contact, country: details.company.country, city: details.company.city },
      questions: parsed.data.messages.filter((message) => message.role === "user").map((message) => message.content),
      apiKey, model: process.env.GEMINI_RESEARCH_MODEL?.trim(), language: parsed.data.language, fetcher: options.fetcher,
    }) : undefined;
    if (research) options.prompt += `\n\nWEB_RESEARCH (external evidence only):\n${JSON.stringify({ ...research, searchSuggestionsHtml: undefined })}`;
    let output: string;
    if (apiKey) {
      try {
        output = await generateGeminiText({ ...options, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() });
      } catch (error) {
        if (!gatewayToken || !isGeminiRegionError(error)) throw error;
        output = await gateway();
      }
    } else output = await gateway();
    const payload = { output, sources: [...citedCompanySources(output, sources), ...(research?.sources ?? [])], coverage: context.coverage, research: research ? { ...research, findings: undefined } : undefined };
    return Response.json(session ? await session.complete(payload) : payload, { headers });
  } catch (error) {
    await session?.fail();
    return Response.json({ error: error instanceof HistoryError ? error.message : "The customer assistant could not respond. Please retry. If this continues, ask your administrator to check the AI provider's key, quota and regional availability." }, { status: error instanceof HistoryError ? error.status : 502, headers });
  } finally { await session?.flush(); }
}
