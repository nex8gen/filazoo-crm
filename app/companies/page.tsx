import { Download, Plus } from "lucide-react";
import { CompaniesTable } from "@/components/companies-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function CompaniesPage() {
  return (
    <div>
      <PageHeader
        title="Companies"
        description="Research, qualify, and track the organizations in your outreach universe."
        actions={<><Button size="sm" variant="outline"><Download /> Export</Button><Button size="sm"><Plus /> Add company</Button></>}
      />
      <CompaniesTable />
    </div>
  );
}
