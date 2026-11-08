import { PurchaseOrdersView, type PurchaseOrderPageProps } from "../purchase-orders-view";

export const metadata = { title: "Draft purchase orders" };

export default function DraftPurchaseOrdersPage(props: PurchaseOrderPageProps) {
  return <PurchaseOrdersView {...props} drafts />;
}
