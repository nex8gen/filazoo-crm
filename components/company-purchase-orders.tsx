import {
  listCompanyPurchaseOrders,
  getPurchaseOrderProfile,
} from "@/app/purchase-order-actions";
import { PurchaseOrderWorkspace } from "@/components/purchase-order-workspace";
import type { CompanyCommerce } from "@/lib/company-commerce";

export async function CompanyPurchaseOrders({
  companyId,
  companyName,
  commerce,
  canWrite,
}: {
  companyId: string;
  companyName: string;
  commerce?: CompanyCommerce;
  canWrite: boolean;
}) {
  const [initial, profile] = await Promise.all([
    listCompanyPurchaseOrders(companyId),
    getPurchaseOrderProfile(companyId),
  ]);
  return (
    <PurchaseOrderWorkspace
      companyId={companyId}
      companyName={companyName}
      commerce={commerce}
      canWrite={canWrite}
      initial={initial}
      profile={profile}
    />
  );
}
