"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Pencil } from "lucide-react";
import { savePurchaseOrder } from "@/app/purchase-order-actions";
import { poStatusLabels, type OrderCustomer, type PurchaseOrder, type PurchaseOrderActivity, type PurchaseOrderDocument } from "@/lib/purchase-orders";
import { purchaseOrderActions } from "@/lib/purchase-order-summary";
import { PurchaseOrderSummary } from "@/components/purchase-order-summary";
import { PurchaseOrderInvoices } from "@/components/purchase-order-invoices";
import { PurchaseOrderPaymentDetails, PurchaseOrderPayments } from "@/components/purchase-order-payments";
import { PageActions } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function PurchaseOrderDetails({ order, companyName, country, customer, activity, activityError, canWrite }: {
  order: PurchaseOrder;
  companyName: string;
  country: string;
  customer?: OrderCustomer;
  activity: PurchaseOrderActivity[];
  activityError?: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const actions = purchaseOrderActions(order);
  function setStatus(status: PurchaseOrderDocument["status"]) {
    startTransition(async () => {
      try {
        const result = await savePurchaseOrder(order.company_id, order.id, order.version, { ...order.document, status });
        if (result.error) setError(result.error);
        else { setError(""); if (order.document.status === "draft" && status === "confirmed") router.push("/purchase-orders"); router.refresh(); }
      } catch { setError("The order status could not be updated. Please try again."); }
    });
  }
  return <>
    <PageActions>{canWrite ? <>
      <Link href={`/purchase-orders/${order.id}/edit`} className={buttonVariants({ size: "sm", variant: "outline" })} aria-disabled={pending || undefined} onClick={event => { if (pending) event.preventDefault(); }}><Pencil className="size-3.5" />Edit order</Link>
      {order.document.status === "draft" ? <Button size="sm" disabled={pending} onClick={() => setStatus("confirmed")}>Confirm order</Button> : null}
      {actions.statuses.length ? <DropdownMenu><DropdownMenuTrigger render={<Button size="sm" variant="outline" disabled={pending} />}>More actions<ChevronDown className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-44"><DropdownMenuGroup><DropdownMenuLabel>Order status</DropdownMenuLabel>{actions.statuses.map(status => <DropdownMenuItem key={status} variant={status === "cancelled" ? "destructive" : "default"} onClick={() => setStatus(status)}>{poStatusLabels[status]}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu> : null}
    </> : null}</PageActions>
    {error ? <p role="alert" className="mx-auto mt-3 max-w-[1100px] rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
    <PurchaseOrderSummary order={order} companyName={companyName} country={country} customer={customer} activity={activity} activityError={activityError}
      paymentDetails={<><PurchaseOrderPaymentDetails billing={order.document.billing} /><PurchaseOrderPayments order={order} canWrite={canWrite} /></>}
      invoiceSection={<PurchaseOrderInvoices order={order} canWrite={canWrite} />} />
  </>;
}
