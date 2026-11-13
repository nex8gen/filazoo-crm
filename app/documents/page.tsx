import { requireWorkspaceMember } from "@/lib/auth";
import { DocumentsWorkspace } from "@/components/documents-workspace";
import { documentCategories } from "@/lib/documents";
import { marketingYearSchema } from "@/lib/marketing-assets";
import { redirect } from "next/navigation";
import { bootstrapDocumentLibrary } from "@/lib/data/documents";
import { documentLibraryQueryKey } from "@/lib/document-library-state";
import { listProducts } from "@/lib/data/crm";

export const metadata = { title: "Files & templates" };
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ category?: string; tab?: string; year?: string }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  if (params.category === "promotion" && params.tab === "planner") {
    const year = marketingYearSchema.safeParse(params.year);
    redirect(`/email/campaigns${year.success ? `?year=${year.data}` : ""}`);
  }
  const category = documentCategories.find(item => item.id === params.category)?.id;
  const key = documentLibraryQueryKey({ view: category === "promotion" || category === "everyday" ? "templates" : "all", category, sort: "newest" });
  const [initialData, { products }] = await Promise.all([
    bootstrapDocumentLibrary(viewer, new URLSearchParams(key)).catch(() => undefined),
    listProducts(),
  ]);
  return <DocumentsWorkspace key={`${viewer.workspaceId}-${viewer.id}-${category ?? "all"}`} initialData={initialData} products={products} canWrite={viewer.role !== "viewer"} workspaceName={viewer.workspaceName} initialCategory={category} />;
}
