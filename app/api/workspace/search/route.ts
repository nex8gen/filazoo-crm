import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { readWorkspaceSearch } from "@/lib/data/workspace-search";
import { normalizeWorkspaceSearch, validWorkspaceSearch } from "@/lib/workspace-search";

export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  const headers = { "Cache-Control": "private, no-store" };
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  const query = normalizeWorkspaceSearch(new URL(request.url).searchParams.get("q") ?? "");
  if (!validWorkspaceSearch(query)) return Response.json({ error: "Use 2-120 characters without wildcard symbols." }, { status: 400, headers });
  try {
    return Response.json(await readWorkspaceSearch(createSupabaseAdmin(), viewer, query), { headers });
  } catch {
    return Response.json({ error: "Record search is temporarily unavailable." }, { status: 503, headers });
  }
}
