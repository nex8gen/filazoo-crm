import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { conversationPatchSchema } from "@/lib/ai/chat-history";
import { ownedConversation, conversationMessages, conversationActions, presentConversation, HistoryError } from "@/lib/ai/chat-history-server";

const headers = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context, method: "GET" | "PATCH" | "DELETE") {
  const origin = request.headers.get("origin");
  if (method !== "GET" && origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to view saved conversations." }, { status: 401, headers });
  return withWorkspaceViewer(viewer, async () => {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid conversation." }, { status: 400, headers });
  try {
    if (method === "DELETE") {
      // Deleting one's own transcript must also work after a record is removed
      // or access changes. The RPC checks ownership and the active turn lock.
      const { data, error } = await createSupabaseAdmin().rpc("delete_ai_conversation", { p_user_id: viewer.id, p_conversation_id: id });
      if (error) throw new HistoryError("Unable to delete this conversation. Please retry.", 503);
      if (!data?.success) throw new HistoryError(data?.pending ? "Wait for the current request to finish before deleting history." : "Conversation unavailable.", data?.pending ? 409 : 404);
      return Response.json({ success: true }, { headers });
    }
    const row = await ownedConversation(id, viewer);
    const db = createSupabaseAdmin();
    if (method === "GET") {
      const before = new URL(request.url).searchParams.get("before");
      if (before !== null && !z.coerce.number().int().positive().safeParse(before).success) throw new HistoryError("Invalid message page.", 400);
      const page = await conversationMessages(id, 40, before === null ? undefined : Number(before));
      const ids = page.messages.flatMap((m) => m.actions?.map((a) => a.id) ?? []);
      return Response.json({ conversation: presentConversation(row), ...page, actionResults: await conversationActions(id, viewer, ids) }, { headers });
    }
    if (method === "PATCH") {
      const text = await request.text();
      if (text.length > 2000) throw new HistoryError("Conversation update is too large.", 413);
      let body: unknown; try { body = JSON.parse(text); } catch { /* Validated below. */ }
      const parsed = conversationPatchSchema.safeParse(body);
      if (!parsed.success) throw new HistoryError("Choose a title, pin or archive change.", 400);
      const { data, error } = await db.from("ai_conversations").update(parsed.data).eq("id", id).eq("user_id", viewer.id).is("active_request", null).select("id").maybeSingle();
      if (error) throw new HistoryError("Unable to update this conversation.", 503);
      if (!data) throw new HistoryError("Wait for the current request to finish before changing history.");
      return Response.json({ success: true }, { headers });
    }
  } catch (error) { return Response.json({ error: error instanceof HistoryError ? error.message : "Saved conversation is unavailable." }, { status: error instanceof HistoryError ? error.status : 403, headers }); }
  });
}
export const GET = (request: Request, context: Context) => handle(request, context, "GET");
export const PATCH = (request: Request, context: Context) => handle(request, context, "PATCH");
export const DELETE = (request: Request, context: Context) => handle(request, context, "DELETE");
