import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { getPurchaseOrder, getPurchaseOrderActivity } from "@/lib/data/purchase-orders";
import { getPurchaseOrderProfile } from "@/app/purchase-order-actions";
import { PurchaseOrderDetails } from "@/components/purchase-order-details";
import type { PurchaseOrderActivity } from "@/lib/purchase-orders";

export const metadata = { title: "Purchase order details" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const order = await getPurchaseOrder(id);
  if (!order) notFound();
  const [customer, history] = await Promise.all([
    order.document.customer ? Promise.resolve(order.document.customer) : getPurchaseOrderProfile(order.company_id).then(profile => profile.customer),
    getPurchaseOrderActivity(id, order.company_id).then(activity => ({ activity, error: false })).catch(() => ({ activity: [] as PurchaseOrderActivity[], error: true })),
  ]);
  const snapshot = createHash("sha256").update(JSON.stringify(order)).digest("hex");
  return <PurchaseOrderDetails key={snapshot} order={order} companyName={order.companyName} country={order.country} customer={customer} activity={history.activity} activityError={history.error} canWrite={viewer.role !== "viewer"} />;
}
