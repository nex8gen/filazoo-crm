import { SegmentsWorkspace } from "@/components/segments-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { listSegmentCompanies } from "@/lib/data/crm";
import { listSavedSegments } from "@/lib/data/segments";
import { listSegmentWorkflowMetrics } from "@/lib/data/segment-workflows";

export const metadata = { title: "Segments" };

export default async function SegmentsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ companies }, savedSegments] = await Promise.all([listSegmentCompanies(), listSavedSegments()]);
  const workflows = await listSegmentWorkflowMetrics(companies.map(company => company.id)).catch(error => {
    console.error("Unable to load segment workflow activity", error);
    return null;
  });
  return <SegmentsWorkspace companies={companies} savedSegments={savedSegments} workflows={workflows} canWrite={viewer.role !== "viewer"} canDeleteBusiness={viewer.role === "admin" || viewer.role === "operator"} />;
}
