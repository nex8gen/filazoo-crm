import { SegmentsWorkspace } from "@/components/segments-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { listSegmentCompanies } from "@/lib/data/crm";
import { listSavedSegments } from "@/lib/data/segments";

export default async function SegmentsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ companies }, savedSegments] = await Promise.all([listSegmentCompanies(), listSavedSegments()]);
  return <SegmentsWorkspace companies={companies} savedSegments={savedSegments} canWrite={viewer.role !== "viewer"} />;
}
