import { getWorkspaceViewer } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { librarySearchInput } from "@/lib/ai/library-search";
import { searchLibraryWithAi } from "@/lib/data/library-ai-search";

export const maxDuration = 90;
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  let viewer;
  try { viewer = await getWorkspaceViewer(); }
  catch { return Response.json({ error: "Unable to verify your workspace session. Please retry." }, { status: 503, headers }); }
  if (!viewer) return Response.json({ error: "Sign in to search your library." }, { status: 401, headers });
  const input = librarySearchInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Describe the files or templates you need." }, { status: 400, headers });
  try { return Response.json(await withWorkspaceViewer(viewer, () => searchLibraryWithAi(viewer, input.data.query, input.data.kind)), { headers }); }
  catch (cause) { return Response.json({ error: cause instanceof Error ? cause.message : "Unable to search the library. Please retry." }, { status: 409, headers }); }
}
