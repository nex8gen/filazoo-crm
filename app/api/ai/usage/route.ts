import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to view AI usage." }, { status: 401, headers });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await createSupabaseAdmin().rpc("ai_chat_usage_totals", { p_user_id: viewer.id, p_since: since });
  if (error) return Response.json({ error: "Unable to load AI usage." }, { status: 503, headers });
  return Response.json({ ...data, since }, { headers });
}
