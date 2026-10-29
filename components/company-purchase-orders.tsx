import {
  listCompanyPurchaseOrders,
  getPurchaseOrderProfile,
  getPurchaseOrderCatalogAvailability,
} from "@/app/purchase-order-actions";
import { PurchaseOrderWorkspace } from "@/components/purchase-order-workspace";
import type { CompanyCommerce } from "@/lib/company-commerce";
import { createHash } from "node:crypto";

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
  const [initial, profile, catalogAvailability] = await Promise.all([
    listCompanyPurchaseOrders(companyId),
    getPurchaseOrderProfile(companyId),
    getPurchaseOrderCatalogAvailability(),
  ]);
  // Revalidation must replace client snapshots after invoice creation or payment changes.
  const snapshotKey = createHash("sha256").update(JSON.stringify(initial)).digest("hex");
  return (
    <PurchaseOrderWorkspace
      key={snapshotKey}
      companyId={companyId}
      companyName={companyName}
      commerce={commerce}
      canWrite={canWrite}
      initial={initial}
      profile={profile}
      catalogAvailability={catalogAvailability}
    />
  );
}
