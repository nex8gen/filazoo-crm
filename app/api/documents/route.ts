import { getWorkspaceViewer } from "@/lib/auth";
import { bootstrapDocumentLibrary, DocumentError, listDocuments, mutateDocument } from "@/lib/data/documents";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof DocumentError ? error.message : "The file library is temporarily unavailable. Try again." }, { status: error instanceof DocumentError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to your workspace." }, { status: 401, headers });
  try {
    const params = new URL(request.url).searchParams;
    return Response.json(await (params.get("bootstrap") === "1" ? bootstrapDocumentLibrary(viewer, params) : listDocuments(viewer, params)), { headers });
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to your workspace." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Make changes from your workspace." }, { status: 403, headers });
  if (Number(request.headers.get("content-length")) > 5000000) return Response.json({ error: "This request is too large." }, { status: 413, headers });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  try { return Response.json(await mutateDocument(viewer, input), { headers }); }
  catch (error) { return failure(error); }
}
