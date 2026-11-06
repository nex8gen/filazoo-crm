import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { conversationInputSchema, conversationScope } from "@/lib/ai/chat-history";
import { assertConversationAccess, conversationAccessKey, conversationDetail, HistoryError, presentConversation, type ConversationRow } from "@/lib/ai/chat-history-server";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to view saved conversations." }, { status: 401, headers });
  return withWorkspaceViewer(viewer, async () => {
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ scope: z.string().min(1).max(3000), view: z.enum(["all", "record"]), search: z.string().max(160), archived: z.enum(["true", "false"]), offset: z.coerce.number().int().min(0).max(10000) }).safeParse({ scope: params.get("scope"), view: params.get("view") || "record", search: params.get("search") || "", archived: params.get("archived") || "false", offset: params.get("offset") || 0 });
  if (!parsed.success) return Response.json({ error: "Invalid history search." }, { status: 400, headers });
  const { scope, view, search, archived, offset } = parsed.data;
  const all = view === "all" && params.get("resume") !== "true";
  let accessKey: string;
  try { accessKey = await conversationAccessKey(viewer); } catch { return Response.json({ error: "Unable to verify access to saved conversations." }, { status: 503, headers }); }
  const db = createSupabaseAdmin();
  if (params.get("titles") === "true" && params.get("resume") !== "true") {
    // This is the viewer's own saved title index, authorized by the same fresh
    // owner/role/access fingerprint as transcripts. Do not load source records,
    // messages, summaries or action results until a title is explicitly opened.
    const fields = "id,mode,pathname,page_context,title,pinned,archived,version,updated_at,active_request";
    let result;
    if (search) {
      result = await (all
        ? db.rpc("search_workspace_ai_conversations", { p_user_id: viewer.id, p_role: viewer.role, p_access_key: accessKey, p_archived: archived === "true", p_search: search, p_offset: offset })
        : db.rpc("search_ai_conversations", { p_user_id: viewer.id, p_role: viewer.role, p_access_key: accessKey, p_scope: scope, p_archived: archived === "true", p_search: search, p_offset: offset })).select(fields);
    } else {
      let query = db.from("ai_conversations").select(fields).eq("user_id", viewer.id).eq("owner_role", viewer.role).eq("access_key", accessKey).eq("archived", archived === "true").gt("version", 0);
      query = all ? query.in("mode", ["chat", "agent"]) : query.eq("scope", scope);
      result = await query.order("pinned", { ascending: false }).order("updated_at", { ascending: false }).order("id").range(offset, offset + 30);
    }
    if (result.error) return Response.json({ error: "Unable to load conversation titles. Please retry." }, { status: 503, headers });
    const titles = (result.data ?? []) as ConversationRow[];
    return Response.json({ conversations: titles.slice(0, 30).map(row => ({ ...presentConversation(row), summary: "" })), hasMore: titles.length > 30, offset: offset + 30, unavailable: 0 }, { headers });
  }
  const { data, error } = params.get("resume") === "true"
    ? await db.from("ai_conversations").select("*").eq("user_id", viewer.id).eq("owner_role", viewer.role).eq("access_key", accessKey).eq("scope", scope).eq("archived", false).gt("version", 0).order("updated_at", { ascending: false }).limit(1)
    : all
      ? await db.rpc("search_workspace_ai_conversations", { p_user_id: viewer.id, p_role: viewer.role, p_access_key: accessKey, p_archived: archived === "true", p_search: search, p_offset: offset })
      : await db.rpc("search_ai_conversations", { p_user_id: viewer.id, p_role: viewer.role, p_access_key: accessKey, p_scope: scope, p_archived: archived === "true", p_search: search, p_offset: offset });
  if (error) return Response.json({ error: "Unable to load history. Check the AI history database migration." }, { status: 503, headers });
  const rows = (data ?? []) as ConversationRow[];
  if (all) {
    // Recheck each distinct record before exposing even its saved title. A
    // deleted record must not hide unrelated, accessible conversations.
    const scopes = new Map(rows.slice(0, 30).map((row) => [row.scope, row]));
    const allowed = new Set<string>();
    // Many saved chats refer to different messages in the same inbox. Reuse
    // only this request's authorized snapshot instead of loading it 30 times.
    const accessContext = { emailInboxes: new Map() };
    await Promise.all([...scopes.values()].map(async (row) => {
      try {
        await assertConversationAccess({ mode: row.mode, pathname: row.pathname, pageContext: row.page_context }, viewer, accessContext);
        allowed.add(row.scope);
      } catch { /* Ownership and current access remain mandatory for old history. */ }
    }));
    const visible = rows.slice(0, 30).filter((row) => allowed.has(row.scope));
    return Response.json({ conversations: visible.map(presentConversation), hasMore: rows.length > 30, offset: offset + 30, unavailable: Math.min(rows.length, 30) - visible.length }, { headers });
  }
  if (params.get("resume") === "true" && params.get("detail") === "true") {
    if (!rows[0]) return Response.json({ conversations: [], detail: null }, { headers });
    const row = rows[0];
    // Ownership, role and the fresh access fingerprint were verified above.
    // Load messages alongside the record check, but release no saved content
    // unless both succeed. A denied record always wins over a storage failure.
    const [access, detail] = await Promise.allSettled([
      assertConversationAccess({ mode: row.mode, pathname: row.pathname, pageContext: row.page_context }, viewer),
      conversationDetail(row, viewer),
    ]);
    if (access.status === "rejected") return Response.json({ error: "This record is no longer available for saved conversations." }, { status: 403, headers });
    if (detail.status === "rejected") return Response.json({ error: "Unable to restore saved messages. Please retry." }, { status: 503, headers });
    return Response.json({ conversations: rows.map(presentConversation), detail: detail.value }, { headers });
  }
  // Exact-scope customer history only needs one record check.
  if (rows[0]) {
    try { await assertConversationAccess({ mode: rows[0].mode, pathname: rows[0].pathname, pageContext: rows[0].page_context }, viewer); }
    catch { return Response.json({ error: "This record is no longer available for saved conversations." }, { status: 403, headers }); }
  }
  return Response.json({ conversations: rows.slice(0, 30).map(presentConversation), hasMore: rows.length > 30, offset: offset + 30 }, { headers });
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to save conversations." }, { status: 401, headers });
  return withWorkspaceViewer(viewer, async () => {
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
  });
}
