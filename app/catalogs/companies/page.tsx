import { Library } from "lucide-react";
import { after } from "next/server";
import { CompanyCatalogsTable } from "@/components/company-catalogs-table";
import { DataModeBanner } from "@/components/data-mode-banner";
import { NewCatalogButton } from "@/components/crm-action-dialogs";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCatalogs, listCompanyOptions, listProducts } from "@/lib/data/crm";
import { prepareCompanyCatalogPdfs } from "@/lib/data/catalog-pdfs";

export default async function CompanyCatalogsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ mode, catalogs }, { companies }, { products }] = await Promise.all([listCatalogs(), listCompanyOptions(), listProducts()]);
  const canWrite = true;
  if (catalogs.some(catalog => !catalog.pdfUrl)) {
    // Saved catalogs may reference products beyond the general selector limit.
    // Resolve those exact SKUs before entering the request-independent callback.
    const loaded = new Set(products.map(product => product.sku));
    const missingSkus = [...new Set(catalogs.filter(catalog => !catalog.pdfUrl).flatMap(catalog => catalog.productSkus).filter(sku => !loaded.has(sku)))];
    const preparedProducts = missingSkus.length ? [...products] : products;
    for (let start = 0; start < missingSkus.length; start += 500) {
      preparedProducts.push(...(await listProducts(missingSkus.slice(start, start + 500))).products);
    }
    // Preserve PDF snapshot preparation without making the list wait for images
    // and Storage. All request-scoped authorization/product reads finish above.
    after(() => prepareCompanyCatalogPdfs(catalogs.map(catalog => ({ ...catalog })), preparedProducts, viewer.id));
  }

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
