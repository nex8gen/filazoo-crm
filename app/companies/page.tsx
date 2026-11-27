import Link from "next/link";
import { CompaniesTable } from "@/components/companies-table";
import { AddCompanyButton, ExportCompaniesButton } from "@/components/crm-action-dialogs";
import { PageActions } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanyPage } from "@/lib/data/company-list";
import { companyListRequestSchema } from "@/lib/company-list";
import { getSavedSegment } from "@/lib/data/segments";
import { notFound } from "next/navigation";
import { z } from "zod";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  const { segment, segmentId } = params;
  if (segmentId !== undefined && !z.uuid().safeParse(segmentId).success) notFound();
  const selectedSegment = typeof segment === "string" ? segment : undefined;
  const savedSegment = typeof segmentId === "string" ? await getSavedSegment(segmentId) : null;
  if (segmentId && !savedSegment) notFound();
  const request = companyListRequestSchema.parse({ page: params.page, pageSize: viewer.preferences?.tablePageSize ?? 25,
    query: params.q, country: params.country, tag: params.tag, sort: params.sort,
    descending: params.direction !== "asc", segment: savedSegment ? undefined : selectedSegment, segmentId: savedSegment?.id });
  const analyticsAsOf = new Date().toISOString();
  const result = await listCompanyPage(request, savedSegment?.rules, analyticsAsOf);
  const exportParams = new URLSearchParams();
  if (savedSegment) exportParams.set("segmentId", savedSegment.id);
  else if (selectedSegment) exportParams.set("segment", selectedSegment);
  const segmentName = savedSegment?.name ?? selectedSegment;
  return (
    <div className="flex min-w-0 flex-col pb-8">
      <div>
        <PageActions>{segmentName ? <><span className="mr-auto text-sm text-muted-foreground">{segmentName}</span><Link href="/segments" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline-offset-4 hover:underline">Segments</Link><Link href="/companies" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline-offset-4 hover:underline">All companies</Link></> : null}<ExportCompaniesButton exportHref={`/api/companies/export?${exportParams}`} /><AddCompanyButton canWrite={viewer.role !== "viewer"} existingSegments={result.segments} /></PageActions>
      </div>
      <CompaniesTable key={`${savedSegment?.id ?? selectedSegment ?? "all"}:${analyticsAsOf}`} result={result} request={{ ...request, page: result.page }} canDelete={viewer.role === "admin"} analyticsAsOf={analyticsAsOf} />
    </div>
  );
}
