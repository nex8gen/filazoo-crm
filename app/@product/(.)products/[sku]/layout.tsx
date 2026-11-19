import type { ReactNode } from "react";
import { ProductProfileSheet } from "@/components/product-profile-sheet";

export default function Layout({ children }: { children: ReactNode }) {
  return <ProductProfileSheet>{children}</ProductProfileSheet>;
}
