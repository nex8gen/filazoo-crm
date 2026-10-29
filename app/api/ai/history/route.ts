import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { conversationInputSchema, conversationScope } from "@/lib/ai/chat-history";
import { assertConversationAccess, conversationAccessKey, HistoryError, presentConversation, type ConversationRow } from "@/lib/ai/chat-history-server";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to view saved conversations." }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ scope: z.string().min(1).max(3000), search: z.string().max(160), archived: z.enum(["true", "false"]), offset: z.coerce.number().int().min(0).max(10000) }).safeParse({ scope: params.get("scope"), search: params.get("search") || "", archived: params.get("archived") || "false", offset: params.get("offset") || 0 });
  if (!parsed.success) return Response.json({ error: "Invalid history search." }, { status: 400, headers });
  const { scope, search, archived, offset } = parsed.data;
  let accessKey: string;
  try { accessKey = await conversationAccessKey(viewer); } catch { return Response.json({ error: "Unable to verify access to saved conversations." }, { status: 503, headers }); }
  const db = createSupabaseAdmin();
  const { data, error } = params.get("resume") === "true"
    ? await db.from("ai_conversations").select("*").eq("user_id", viewer.id).eq("owner_role", viewer.role).eq("access_key", accessKey).eq("scope", scope).eq("archived", false).gt("version", 0).order("updated_at", { ascending: false }).limit(1)
    : await db.rpc("search_ai_conversations", { p_user_id: viewer.id, p_role: viewer.role, p_access_key: accessKey, p_scope: scope, p_archived: archived === "true", p_search: search, p_offset: offset });
  if (error) return Response.json({ error: "Unable to load history. Check the AI history database migration." }, { status: 503, headers });
  const rows = (data ?? []) as ConversationRow[];
  // Rows share one canonical record scope and access fingerprint. Revalidate
  // that record once instead of reloading the same inbox for every list item.
  if (rows[0]) {
    try { await assertConversationAccess({ mode: rows[0].mode, pathname: rows[0].pathname, pageContext: rows[0].page_context }, viewer); }
    catch { return Response.json({ error: "This record is no longer available for saved conversations." }, { status: 403, headers }); }
  }
  return Response.json({ conversations: rows.slice(0, 30).map(presentConversation), hasMore: rows.length > 30, offset: offset + 30 }, { headers });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to save conversations." }, { status: 401, headers });
  const text = await request.text();
  if (text.length > 8000) return Response.json({ error: "Conversation context is too large." }, { status: 413, headers });
  let body: unknown; try { body = JSON.parse(text); } catch { /* Validated below. */ }
  const parsed = conversationInputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid conversation." }, { status: 400, headers });
  try {
    await assertConversationAccess(parsed.data, viewer);
    const accessKey = await conversationAccessKey(viewer);
    const { mode, pathname, pageContext } = parsed.data;
    const { data, error } = await createSupabaseAdmin().from("ai_conversations").insert({ user_id: viewer.id, owner_role: viewer.role, access_key: accessKey, mode, pathname, page_context: pageContext ?? {}, scope: conversationScope(parsed.data) }).select("*").single();
    if (error) throw new HistoryError("Unable to save a conversation. Check the AI history database migration.", 503);
    return Response.json({ conversation: presentConversation(data as ConversationRow) }, { status: 201, headers });
  } catch (error) { return Response.json({ error: error instanceof HistoryError ? error.message : "This record is unavailable for saved conversations." }, { status: error instanceof HistoryError ? error.status : 403, headers }); }
}
