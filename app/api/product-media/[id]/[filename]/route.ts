import { getWorkspaceViewer } from "@/lib/auth";
import { DocumentError } from "@/lib/data/documents";
import { productMediaDownload } from "@/lib/data/product-media";

export async function GET(_request: Request, context: { params: Promise<{ id: string; filename: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const viewer = await getWorkspaceViewer();
  if (!viewer) return new Response(null, { status: 401, headers });
  const { id, filename } = await context.params;
  try {
    const url = await productMediaDownload(viewer, `/api/product-media/${id}/${filename}`);
    return new Response(null, { status: 307, headers: { ...headers, Location: url } });
  } catch (error) { return new Response(null, { status: error instanceof DocumentError ? error.status : 503, headers }); }
}
