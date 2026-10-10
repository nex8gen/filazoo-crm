import { Package2 } from "lucide-react";
import { DataModeBanner } from "@/components/data-mode-banner";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { ProductsCatalog } from "@/components/products-catalog";
import { requireWorkspaceMember } from "@/lib/auth";
import { listProducts } from "@/lib/data/crm";

export default async function CatalogsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const { mode, products } = await listProducts();
  const activeProducts = products.filter((product) => product.status === "Active").length;
  const quotedProducts = products.filter((product) => product.stockStatus === "Quote available").length;

  return (
    <div className="space-y-5">
      <PageHeader title="Products" description="Manage the complete B2B range, volume pricing, color variants, availability, and customer-ready exports." />
      <DataModeBanner mode={mode} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Total products</p><p className="mt-1 text-2xl font-semibold tracking-tight">{products.length}</p></div>
        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Active products</p><p className="mt-1 text-2xl font-semibold tracking-tight">{activeProducts}</p></div>
        <div className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">Ready to quote</p><p className="mt-1 text-2xl font-semibold tracking-tight">{quotedProducts}</p></div>
      </div>
      {products.length === 0 ? (
        <EmptyState icon={Package2} title="No products synced" description="Add your first product or connect a source to populate pricing, colors, and availability." />
      ) : <ProductsCatalog products={products} canWrite={viewer.role !== "viewer"} />}
    </div>
  );
}
