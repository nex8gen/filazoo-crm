import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";
import { getSavedSegment } from "@/lib/data/segments";
import { matchesSegment, toSegmentCompany } from "@/lib/segments";
import { companyExportCsv } from "@/lib/company-export";
import { z } from "zod";

export async function GET(request: Request) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = new URL(request.url).searchParams;
  const segmentId = params.get("segmentId");
  if (segmentId && !z.uuid().safeParse(segmentId).success) return new Response("Invalid segment", { status: 400 });
  const saved = segmentId ? await getSavedSegment(segmentId) : null;
  if (segmentId && !saved) return new Response("Segment not found", { status: 404 });
  const segment = params.get("segment");
  // Full export is deliberately loaded only on demand, never on a table visit.
  const { companies } = await listCompanies(saved?.rules.companyIds ? { ids: saved.rules.companyIds } : {});
  const visible = saved ? companies.filter(company => matchesSegment(toSegmentCompany(company), saved.rules)) : segment ? companies.filter(company => company.segment === segment) : companies;
  return new Response(companyExportCsv(visible), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, no-store",
    "Content-Disposition": 'attachment; filename="filazoo-companies.csv"',
  } });
}
