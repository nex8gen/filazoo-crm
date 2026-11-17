import type { ReactNode } from "react";
import { CompanyProfileSheet } from "@/components/company-profile-sheet";

export default function Layout({ children }: { children: ReactNode }) {
  return <CompanyProfileSheet>{children}</CompanyProfileSheet>;
}
