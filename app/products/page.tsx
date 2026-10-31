import { Package2 } from "lucide-react";
import { DataModeBanner } from "@/components/data-mode-banner";
import { EmptyState } from "@/components/data-state";
import { ProductsCatalogV2 } from "@/components/products-catalog-v2";
import { requireWorkspaceMember } from "@/lib/auth";
import { listProducts } from "@/lib/data/crm";
import { getInventoryState } from "@/lib/data/inventory";
import { InventoryConnection } from "@/components/inventory-connection";

export const metadata = { title: "Products" };

export default async function CatalogsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { mode, products } = await listProducts();
  const { status: inventoryStatus } = await getInventoryState();

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-8">
      <h1 className="shrink-0 text-xl font-semibold tracking-tight">Products</h1>
      <DataModeBanner mode={mode} />
      <InventoryConnection status={inventoryStatus} canSync={viewer.role === "admin" || viewer.role === "operator"} canManage={viewer.role === "admin"} matched={products.filter(product => product.stock).length} total={products.length} />
      {products.length === 0 ? (
        <EmptyState icon={Package2} title="No products synced" description="Add your first product or connect a source to populate pricing, colors, and availability." />
      ) : <ProductsCatalogV2 products={products} canWrite={viewer.role !== "viewer"} mode={mode} />}
    </div>
  );
}
