import { ExternalLink, Library } from "lucide-react";
import { NewCatalogButton } from "@/components/crm-action-dialogs";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireWorkspaceMember } from "@/lib/auth";
import { listCatalogs, listCompanies, listProducts } from "@/lib/data/crm";

export default async function CatalogsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const [{ catalogs }, { companies }, { products }] = await Promise.all([listCatalogs(), listCompanies(), listProducts()]);
  const canWrite = viewer.role !== "viewer";

  return (
    <div>
      <PageHeader title="Catalogs" description="Prepare focused product selections for each company and buying context." actions={<NewCatalogButton companies={companies} products={products} canWrite={canWrite} />} />
      {catalogs.length === 0 ? (
        <EmptyState icon={Library} title="No catalogs generated" description="Create a tailored product selection after a company’s likely materials and products are known.">
          <NewCatalogButton companies={companies} products={products} canWrite={canWrite} label="Create catalog" />
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {catalogs.map((catalog) => (
            <Card key={catalog.id} className="shadow-none">
              <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-sm">{catalog.company}</CardTitle><CardDescription className="text-xs">Catalog v{catalog.version} · {catalog.currency}</CardDescription></div><Badge variant="outline">{catalog.productSkus.length} products</Badge></div></CardHeader>
              <CardContent className="space-y-3"><p className="text-xs text-muted-foreground">Price date: {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(catalog.priceDate))}</p>{catalog.productSkus.length ? <p className="line-clamp-2 text-xs text-muted-foreground">{catalog.productSkus.join(" · ")}</p> : <p className="text-xs text-muted-foreground">Empty catalog shell—add products after the product source is connected.</p>}{catalog.pdfUrl ? <Button nativeButton={false} size="sm" variant="outline" render={<a href={catalog.pdfUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Open PDF</Button> : <Badge variant="secondary">PDF renderer not connected</Badge>}</CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
