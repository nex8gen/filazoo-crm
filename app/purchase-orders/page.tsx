import { PurchaseOrdersView, type PurchaseOrderPageProps } from "./purchase-orders-view";

export const metadata = { title: "Purchase Order" };

export default function PurchaseOrdersPage(props: PurchaseOrderPageProps) {
  return <PurchaseOrdersView {...props} />;
}
