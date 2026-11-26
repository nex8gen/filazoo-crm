import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { requireAiFeature } from "@/lib/data/ai-settings";
import { conversationRequestSchema, conversationMessagesSchema } from "@/lib/ai/customer-conversations";
import { isCustomerHistoryMessage, loadCustomerEmailBody, loadCustomerEmailHistories } from "@/lib/ai/customer-email-history";
import { groupEmailConversations } from "@/lib/email-threading";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const parsed = conversationRequestSchema.safeParse({ companyId: params.get("companyId"), threadId: params.get("threadId") });
  if (!parsed.success) return Response.json({ error: "Invalid conversation." }, { status: 400, headers });
  let viewer: Awaited<ReturnType<typeof getWorkspaceViewer>>;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your session." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to view conversations." }, { status: 401, headers });
  return withWorkspaceViewer(viewer, async () => {
    try {
      await requireAiFeature("chat", "customers", "emails");
      const context = {};
      const { companyId, threadId } = parsed.data;
      const history = (await loadCustomerEmailHistories(viewer, [companyId], context)).get(companyId);
      if (!history) return Response.json({ error: "Conversation unavailable." }, { status: 404, headers });
      const thread = groupEmailConversations(history.emails.filter(isCustomerHistoryMessage)).get(threadId);
      if (!thread) return Response.json({ error: "Conversation unavailable." }, { status: 404, headers });
      const sorted = [...thread].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      const selected = sorted.slice(-24);
      const loaded = await Promise.all(selected.map(email => loadCustomerEmailBody(viewer, companyId, email, context)));
      return Response.json(conversationMessagesSchema.parse({
        messages: loaded.map(email => ({ id: email.id, sender: email.direction === "outbound" ? email.from || "Team" : email.contactName || email.from || email.contact,
          timestamp: new Date(email.timestamp).toISOString(), direction: email.direction, available: email.bodyLoaded !== false,
          body: email.bodyLoaded === false ? "" : email.body.slice(0, 12000), truncated: email.body.length > 12000 })),
        more: sorted.length > selected.length,
      }), { headers });
    } catch {
      return Response.json({ error: "Unable to load this conversation." }, { status: 403, headers });
    }
  });
}
