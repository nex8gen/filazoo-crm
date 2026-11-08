import { DataModeBanner } from "@/components/data-mode-banner";
import { ProductsCatalogV2 } from "@/components/products-catalog-v2";
import { requireWorkspaceMember } from "@/lib/auth";
import { listProducts } from "@/lib/data/crm";

export const metadata = { title: "Products" };

export default async function CatalogsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { mode, products } = await listProducts();

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-8">
      <DataModeBanner mode={mode} />
      <ProductsCatalogV2 products={products} canWrite={viewer.role !== "viewer"} mode={mode} />
    </div>
  );
}
