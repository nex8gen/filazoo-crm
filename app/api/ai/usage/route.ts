import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to view AI usage." }, { status: 401, headers });
  return withWorkspaceViewer(viewer, async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { data, error } = await createSupabaseAdmin().rpc("ai_chat_usage_totals", { p_user_id: viewer.id, p_since: since });
      if (error) throw error;
      return Response.json({ ...data, since }, { headers });
    } catch {
      return Response.json({ error: "Unable to load AI usage. Please try again." }, { status: 503, headers });
    }
  });
}
