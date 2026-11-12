import { getWorkspaceViewer } from "@/lib/auth";
import { DocumentError, documentDownload, getLibraryDocument } from "@/lib/data/documents";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getWorkspaceViewer();
  const headers = { "Cache-Control": "private, no-store" };
  if (!viewer) return Response.json({ error: "Sign in to your workspace." }, { status: 401, headers });
  try {
    const query = new URL(request.url).searchParams;
    const id = (await params).id;
    return Response.json(query.get("details") === "1" ? await getLibraryDocument(viewer, id) : await documentDownload(viewer, id, query.get("download") === "1"), { headers });
  }
  catch (error) { return Response.json({ error: error instanceof DocumentError ? error.message : "Unable to open this file." }, { status: error instanceof DocumentError ? error.status : 503, headers }); }
}
