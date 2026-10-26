import { PipelineWorkspace } from "@/components/pipeline-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";
import { listBdSalesManagers } from "@/lib/data/members";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ companies }, managers] = await Promise.all([listCompanies(), listBdSalesManagers()]);
  return <PipelineWorkspace key={company || "all"} companies={companies} managers={managers} canWrite={viewer.role !== "viewer"} canAssign={viewer.role === "admin"} initialCompanyId={company} />;
}
