import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { getPurchaseOrder } from "@/lib/data/purchase-orders";
import { getPurchaseOrderProfile, loadPurchaseOrderProducts } from "@/app/purchase-order-actions";
import { PurchaseOrderComposer } from "@/components/purchase-order-composer";

export const metadata = { title: "Edit order" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const order = await getPurchaseOrder(id);
  if (!order) notFound();
  const skus = [...new Set(order.document.items.flatMap(item => item.productSku ? [item.productSku] : []))];
  const [profile, catalog] = await Promise.all([
    getPurchaseOrderProfile(order.company_id),
    loadPurchaseOrderProducts(skus).then(result => ({ products: result.products, error: false })).catch(() => ({ products: [], error: true })),
  ]);
  return <PurchaseOrderComposer key={order.id} companies={[{ id: order.company_id, name: order.companyName }]} initialCompanyId={order.company_id} initialProfile={profile} initialOrder={order} initialProducts={catalog.products} catalogError={catalog.error} today={new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })} />;
}
