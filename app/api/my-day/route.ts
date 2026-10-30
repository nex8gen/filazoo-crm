import { getWorkspaceViewer } from "@/lib/auth";
import { readMyDayData } from "@/lib/data/my-day";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401 });
  try {
    return Response.json(await readMyDayData(createSupabaseAdmin(), viewer), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Unable to load My Day. Please try again." }, { status: 503 });
  }
}
