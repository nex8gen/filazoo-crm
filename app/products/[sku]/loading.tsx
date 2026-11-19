import { ProductProfileSheet } from "@/components/product-profile-sheet";
import { ProductDetailsSkeleton } from "@/components/product-details-skeleton";
import { ProductsSkeleton } from "@/components/workspace-skeletons";

export default function Loading() {
  return <><ProductsSkeleton /><ProductProfileSheet returnToCatalog><ProductDetailsSkeleton /></ProductProfileSheet></>;
}
