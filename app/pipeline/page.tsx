import { Filter, Plus } from "lucide-react";
import { KanbanBoard } from "@/components/kanban-board";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listCompanies } from "@/lib/data/crm";

export default async function PipelinePage() {
  const { companies } = await listCompanies();
  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Move qualified companies through the outreach journey and keep high-value opportunities visible."
        actions={<><Button size="sm" variant="outline"><Filter /> Filter</Button><Button size="sm"><Plus /> Add opportunity</Button></>}
      />
      <KanbanBoard companies={companies} />
    </div>
  );
}
