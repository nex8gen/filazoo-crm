import { PipelineWorkspace } from "@/components/pipeline-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";

export default async function PipelinePage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const { companies } = await listCompanies();
  return <PipelineWorkspace companies={companies} canWrite={viewer.role !== "viewer"} />;
}
