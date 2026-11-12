import { getWorkspaceViewer } from "@/lib/auth";
import { documentConnectionContext } from "@/lib/data/document-connections";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to your workspace." }, { status: 401, headers });
  try { return Response.json(await documentConnectionContext(viewer), { headers }); }
  catch { return Response.json({ error: "Unable to load customers, products and purchase orders. Try again." }, { status: 503, headers }); }
}
