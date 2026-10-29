import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/products-catalog-v2";
import { requireWorkspaceMember } from "@/lib/auth";
import { listProducts } from "@/lib/data/crm";

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  await requireWorkspaceMember();
  const { sku } = await params;
  const { mode, products } = await listProducts([sku]);
  const product = products.find((item) => item.sku === sku);
  if (!product) notFound();
  return <ProductDetail product={product} mode={mode} />;
}
