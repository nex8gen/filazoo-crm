import { Library } from "lucide-react";
import { CompanyCatalogsTable } from "@/components/company-catalogs-table";
import { DataModeBanner } from "@/components/data-mode-banner";
import { NewCatalogButton } from "@/components/crm-action-dialogs";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCatalogs, listCompanies, listProducts } from "@/lib/data/crm";
import { prepareCompanyCatalogPdfs } from "@/lib/data/catalog-pdfs";

export default async function CompanyCatalogsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ mode, catalogs }, { companies }, { products }] = await Promise.all([listCatalogs(), listCompanies(), listProducts()]);
  const canWrite = viewer.role !== "viewer";
  await prepareCompanyCatalogPdfs(catalogs);

  return (
    <div className="space-y-5">
      <PageHeader title="Company Catalogs" description="Create tailored product selections for each company and buying context." actions={<NewCatalogButton companies={companies} products={products} canWrite={canWrite} />} />
      <DataModeBanner mode={mode} />
      {catalogs.length === 0 ? (
        <EmptyState icon={Library} title="No company catalogs yet" description="Create a tailored product selection after a company’s likely materials and products are known.">
          <NewCatalogButton companies={companies} products={products} canWrite={canWrite} label="Create catalog" />
        </EmptyState>
      ) : (
        <CompanyCatalogsTable catalogs={catalogs} />
      )}
    </div>
  );
}
