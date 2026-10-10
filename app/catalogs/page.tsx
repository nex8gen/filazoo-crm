import { Library, Plus } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function CatalogsPage() {
  return <div><PageHeader title="Catalogs" description="Prepare focused product selections for each company and buying context." actions={<Button size="sm"><Plus /> New catalog</Button>} /><EmptyState icon={Library} title="No catalogs generated" description="Create a tailored catalog after a company’s likely materials and products are known." action={{ label: "Create catalog" }} /></div>;
}
