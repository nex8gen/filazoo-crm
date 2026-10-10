import { CompaniesTable } from "@/components/companies-table";
import { AddCompanyButton, ExportCompaniesButton } from "@/components/crm-action-dialogs";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCompanies } from "@/lib/data/crm";

export default async function CompaniesPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const { companies, mode } = await listCompanies();
  return (
    <div>
      <PageHeader
        title="Companies"
        description="Research, qualify, and track the organizations in your outreach universe."
        actions={<><ExportCompaniesButton companies={companies} /><AddCompanyButton canWrite={viewer.role !== "viewer"} /></>}
      />
      <CompaniesTable companies={companies} mode={mode} />
    </div>
  );
}
