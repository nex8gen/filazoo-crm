import { poStatusLabels, type PurchaseOrderDocument } from "@/lib/purchase-orders";

const styles = {
  draft: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  in_production: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  shipped: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
};

export function PurchaseOrderStatus({ status }: { status: PurchaseOrderDocument["status"] }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}><span className="size-1.5 rounded-full bg-current" aria-hidden />{poStatusLabels[status]}</span>;
}
