import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { listProducts, listCatalogs } from "@/lib/data/crm";

// Product inventory and PDFs are needed for composing, never for reading mail.
export async function GET() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return withWorkspaceViewer(viewer, async () => {
    const [products, catalogs] = await Promise.all([listProducts(), listCatalogs()]);
    return Response.json({ products: products.products, catalogs: catalogs.catalogs }, { headers: { "Cache-Control": "no-store" } });
  });
}
