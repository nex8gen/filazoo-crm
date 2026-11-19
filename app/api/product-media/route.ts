import { getWorkspaceViewer } from "@/lib/auth";
import { DocumentError } from "@/lib/data/documents";
import { listProductMedia } from "@/lib/data/product-media";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to your workspace." }, { status: 401, headers });
  try { return Response.json(await listProductMedia(viewer, new URL(request.url).searchParams), { headers }); }
  catch (error) { return Response.json({ error: error instanceof DocumentError ? error.message : "Could not load company media." }, { status: error instanceof DocumentError ? error.status : 503, headers }); }
}
