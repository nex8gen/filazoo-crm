import { SegmentsWorkspace } from "@/components/segments-workspace";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";
import { listSavedSegments } from "@/lib/data/segments";
import { toSegmentCompany } from "@/lib/segments";

export default async function SegmentsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ companies }, savedSegments] = await Promise.all([listCompanies(), listSavedSegments()]);
  return <SegmentsWorkspace companies={companies.map(toSegmentCompany)} savedSegments={savedSegments} canWrite={viewer.role !== "viewer"} />;
}
