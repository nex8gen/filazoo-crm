import Link from "next/link";
import { CompaniesTable } from "@/components/companies-table";
import { AddCompanyButton, ExportCompaniesButton } from "@/components/crm-action-dialogs";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ segment?: string | string[] }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { segment } = await searchParams;
  const selectedSegment = typeof segment === "string" ? segment : undefined;
  const { companies, mode } = await listCompanies();
  const visibleCompanies = selectedSegment ? companies.filter((company) => company.segment === selectedSegment) : companies;
  return (
    <div className="flex min-w-0 flex-col pb-8">
      <div>
        <PageHeader
          title="Companies"
          description={selectedSegment ? `Companies in the ${selectedSegment} segment.` : "A clear view of every account, source, market, and next sales opportunity."}
          actions={<>{selectedSegment ? <Link href="/companies" className="inline-flex min-h-9 items-center px-3 text-sm text-primary underline-offset-4 hover:underline">All companies</Link> : null}<ExportCompaniesButton companies={visibleCompanies} /><AddCompanyButton canWrite={viewer.role !== "viewer"} /></>}
        />
      </div>
      <CompaniesTable key={selectedSegment ?? "all"} companies={visibleCompanies} mode={mode} canWrite={viewer.role !== "viewer"} canDelete={viewer.role === "admin"} />
    </div>
  );
}
