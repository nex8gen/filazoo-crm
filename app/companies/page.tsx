import Link from "next/link";
import { CompaniesTable } from "@/components/companies-table";
import { AddCompanyButton, ExportCompaniesButton } from "@/components/crm-action-dialogs";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";
import { getSavedSegment } from "@/lib/data/segments";
import { matchesSegment, toSegmentCompany } from "@/lib/segments";
import { notFound } from "next/navigation";
import { z } from "zod";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ segment?: string | string[]; segmentId?: string | string[] }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { segment, segmentId } = await searchParams;
  if (segmentId !== undefined && !z.uuid().safeParse(segmentId).success) notFound();
  const selectedSegment = typeof segment === "string" ? segment : undefined;
  const [{ companies, mode }, savedSegment] = await Promise.all([listCompanies(), typeof segmentId === "string" ? getSavedSegment(segmentId) : Promise.resolve(null)]);
  if (segmentId && !savedSegment) notFound();
  const visibleCompanies = savedSegment ? companies.filter((company) => matchesSegment(toSegmentCompany(company), savedSegment.rules)) : selectedSegment ? companies.filter((company) => company.segment === selectedSegment) : companies;
  const segmentName = savedSegment?.name ?? selectedSegment;
  return (
    <div className="flex min-w-0 flex-col pb-8">
      <div>
        <PageHeader
          title="Companies"
          description={segmentName ? `Companies in the ${segmentName} segment.` : "A clear view of every account, source, market, and next follow-up."}
          actions={<>{segmentName ? <><Link href="/segments" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline-offset-4 hover:underline">Segments</Link><Link href="/companies" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline-offset-4 hover:underline">All companies</Link></> : null}<ExportCompaniesButton companies={visibleCompanies} /><AddCompanyButton canWrite={viewer.role !== "viewer"} /></>}
        />
      </div>
      <CompaniesTable key={savedSegment?.id ?? selectedSegment ?? "all"} viewKey={savedSegment?.id ?? selectedSegment ?? "all"} companies={visibleCompanies} mode={mode} canWrite={viewer.role !== "viewer"} canDelete={viewer.role === "admin"} />
    </div>
  );
}
