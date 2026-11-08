import { getErpSettingsView } from "@/lib/data/erp-settings";
import { getInventoryState } from "@/lib/data/inventory";
import { listProducts } from "@/lib/data/crm";
import { ErpConnectionForm } from "../erp-connection-form";

export async function ErpSection() {
  const [erp, inventory, catalog] = await Promise.all([getErpSettingsView(), getInventoryState(), listProducts()]);
  const products = [...new Map(catalog.products.flatMap(product => [{ sku: product.sku, name: product.name }, ...product.variants.map(variant => ({ sku: variant.sku, name: `${product.name} — ${variant.name}` }))]).map(product => [product.sku, product])).values()];
  return <div className="settings-content settings-section-enter space-y-4"><ErpConnectionForm key={erp.revision} initial={erp} status={inventory.status} products={products} /></div>;
}
