import { CompaniesTable } from "@/components/companies-table";
import { AddCompanyButton, ExportCompaniesButton } from "@/components/crm-action-dialogs";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";

export default async function CompaniesPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { companies, mode } = await listCompanies();
  return (
    <div className="flex min-h-0 flex-col pb-8 md:h-full md:pb-0">
      <div className="px-5 sm:px-7 lg:px-10">
        <PageHeader
          title="Companies"
          description="A clear view of every account, source, market, and next sales opportunity."
          actions={<><ExportCompaniesButton companies={companies} /><AddCompanyButton canWrite={viewer.role !== "viewer"} /></>}
        />
      </div>
      <CompaniesTable companies={companies} mode={mode} canWrite={viewer.role !== "viewer"} canDelete={viewer.role === "admin"} />
    </div>
  );
}
