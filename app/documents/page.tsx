import { requireWorkspaceMember } from "@/lib/auth";
import { DocumentsWorkspace } from "@/components/documents-workspace";
import { documentCategories } from "@/lib/documents";
import { marketingYearSchema } from "@/lib/marketing-assets";
import { redirect } from "next/navigation";
import { bootstrapDocumentLibrary } from "@/lib/data/documents";
import { documentLibraryQueryKey } from "@/lib/document-library-state";

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
  let initialData;
  try { initialData = await bootstrapDocumentLibrary(viewer, new URLSearchParams(key)); } catch { /* The client can retry and show its existing error state. */ }
  return <DocumentsWorkspace key={`${viewer.workspaceId}-${viewer.id}-${category ?? "all"}`} initialData={initialData} canWrite={viewer.role !== "viewer"} workspaceName={viewer.workspaceName} initialCategory={category} />;
}
