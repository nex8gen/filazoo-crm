import CatalogsPage from "@/app/products/page";
import { ProductProfileSheet } from "@/components/product-profile-sheet";
import ProductDetails from "./product-detail";

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const detail = await ProductDetails({ params });
  return <>
    <CatalogsPage />
    <ProductProfileSheet returnToCatalog>{detail}</ProductProfileSheet>
  </>;
}
